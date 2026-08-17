import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isProjectSnapshot, type ProjectSnapshot } from "@f-engine/contracts";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished, pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import {
  validateRenderProfile,
  type RenderProfile
} from "@f-engine/reel-engine";
import {
  defaultMediaLimits,
  inspectMedia,
  MediaProbeError,
  probeMediaFile,
  renderObjectKey,
  renderPreview,
  type DetectedMedia,
  type MediaLimits,
  type MediaInput
} from "./index.js";
import type { InspectionJob, PreviewJob, QueueHandlers } from "./queue.js";
import { processFalImageJob } from "./fal-image.js";
import { processFalVideoJob } from "./fal-video.js";

interface ObjectIdentity {
  etag: string;
  versionId?: string;
  sha256: string;
}

interface InspectionResult {
  detected: DetectedMedia;
  identity?: ObjectIdentity;
}

export interface WorkerObjectStore {
  inspect(objectKey: string, maxBytes: number, signal?: AbortSignal): Promise<InspectionResult>;
  seal(sourceKey: string, sealedKey: string, identity: ObjectIdentity, signal?: AbortSignal): Promise<ObjectIdentity>;
  downloadSealed(objectKey: string, destination: string, identity: ObjectIdentity, signal?: AbortSignal): Promise<void>;
  delete(objectKey: string, signal?: AbortSignal): Promise<void>;
  put(
    objectKey: string,
    body: Uint8Array | Readable,
    contentType: string,
    contentLength: number,
    signal?: AbortSignal
  ): Promise<void>;
  /** Short-lived HTTPS GET for sealed objects; used only for outbound FAL submit. */
  signedGet(objectKey: string, expiresInSeconds?: number): Promise<string>;
}

class RenderCompletionRefusedError extends Error {}

async function sha256File(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NoSuchKey" || candidate.name === "NotFound"
    || candidate.$metadata?.httpStatusCode === 404;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`invalid ${name}`);
  return parsed;
}

export function mediaLimitsFromEnv(env: Record<string, string | undefined>): MediaLimits {
  return {
    maxWidth: positiveInteger(env.MEDIA_MAX_WIDTH, defaultMediaLimits.maxWidth, "MEDIA_MAX_WIDTH"),
    maxHeight: positiveInteger(env.MEDIA_MAX_HEIGHT, defaultMediaLimits.maxHeight, "MEDIA_MAX_HEIGHT"),
    maxPixels: positiveInteger(env.MEDIA_MAX_PIXELS, defaultMediaLimits.maxPixels, "MEDIA_MAX_PIXELS"),
    maxVideoDurationMs: positiveInteger(
      env.MEDIA_MAX_VIDEO_DURATION_MS,
      defaultMediaLimits.maxVideoDurationMs,
      "MEDIA_MAX_VIDEO_DURATION_MS"
    ),
    probeTimeoutMs: positiveInteger(
      env.MEDIA_PROBE_TIMEOUT_MS,
      defaultMediaLimits.probeTimeoutMs,
      "MEDIA_PROBE_TIMEOUT_MS"
    )
  };
}

export class S3WorkerObjectStore implements WorkerObjectStore {
  constructor(
    readonly client: S3Client,
    readonly bucket: string,
    readonly probeTimeoutMs = defaultMediaLimits.probeTimeoutMs
  ) {}

  async signedGet(objectKey: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds }
    );
  }


  async inspect(objectKey: string, maxBytes: number, signal?: AbortSignal): Promise<InspectionResult> {
    const head = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: objectKey
    }), { abortSignal: signal });
    const bytes = Number(head.ContentLength ?? 0);
    if (bytes <= 0) return { detected: { type: "application/octet-stream", bytes: 0 } };
    if (bytes > maxBytes) return { detected: { type: "application/octet-stream", bytes } };
    if (!head.ETag) throw new Error("object identity missing");

    const directory = await mkdtemp(join(tmpdir(), "fengine-inspect-"));
    const path = join(directory, "object");
    try {
      await this.download(objectKey, path, head.ETag, head.VersionId, signal);
      const identity = {
        etag: head.ETag,
        ...(head.VersionId ? { versionId: head.VersionId } : {}),
        sha256: await sha256File(path, signal)
      };
      let probed: Omit<DetectedMedia, "bytes">;
      try {
        probed = await probeMediaFile(path, signal, this.probeTimeoutMs);
      } catch (error) {
        if (signal?.aborted || (error instanceof MediaProbeError && error.code === "timeout")) {
          throw error;
        }
        return { detected: { type: "application/octet-stream", bytes }, identity };
      }
      return {
        detected: { ...probed, bytes },
        identity
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async download(
    objectKey: string,
    destination: string,
    etag: string,
    versionId?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      IfMatch: etag,
      ...(versionId ? { VersionId: versionId } : {})
    }), { abortSignal: signal });
    if (!result.Body) throw new Error("object body missing");
    await pipeline(result.Body as Readable, createWriteStream(destination), { signal });
  }

  async downloadSealed(
    objectKey: string,
    destination: string,
    identity: ObjectIdentity,
    signal?: AbortSignal
  ): Promise<void> {
    await this.download(objectKey, destination, identity.etag, identity.versionId, signal);
    if (await sha256File(destination, signal) !== identity.sha256) {
      throw new Error("sealed object identity mismatch");
    }
  }

  async seal(
    sourceKey: string,
    sealedKey: string,
    identity: ObjectIdentity,
    signal?: AbortSignal
  ): Promise<ObjectIdentity> {
    const directory = await mkdtemp(join(tmpdir(), "fengine-seal-"));
    const verificationPath = join(directory, "object");
    try {
      try {
        const existing = await this.client.send(new HeadObjectCommand({
          Bucket: this.bucket,
          Key: sealedKey
        }), { abortSignal: signal });
        if (!existing.ETag) throw new Error("sealed object identity missing");
        const sealedIdentity = {
          etag: existing.ETag,
          ...(existing.VersionId ? { versionId: existing.VersionId } : {}),
          sha256: identity.sha256
        };
        await this.downloadSealed(sealedKey, verificationPath, sealedIdentity, signal);
        return sealedIdentity;
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }

      const encodedSource = `${this.bucket}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`
        + (identity.versionId ? `?versionId=${encodeURIComponent(identity.versionId)}` : "");
      await this.client.send(new CopyObjectCommand({
        Bucket: this.bucket,
        Key: sealedKey,
        CopySource: encodedSource,
        CopySourceIfMatch: identity.etag
      }), { abortSignal: signal });
      const sealed = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: sealedKey
      }), { abortSignal: signal });
      if (!sealed.ETag) throw new Error("sealed object identity missing");
      const sealedIdentity = {
        etag: sealed.ETag,
        ...(sealed.VersionId ? { versionId: sealed.VersionId } : {}),
        sha256: identity.sha256
      };
      await this.downloadSealed(sealedKey, verificationPath, sealedIdentity, signal);
      return sealedIdentity;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async delete(objectKey: string, signal?: AbortSignal): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { abortSignal: signal }
    );
  }

  async put(
    objectKey: string,
    body: Uint8Array | Readable,
    contentType: string,
    contentLength: number,
    signal?: AbortSignal
  ): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      ContentLength: contentLength
    }), { abortSignal: signal });
  }

}

async function event(
  pool: pg.Pool,
  jobId: string,
  phase: string,
  percent: number
): Promise<boolean> {
  const updated = await pool.query(
    `UPDATE "RenderJob" SET state = 'running'
      WHERE id = $1 AND state IN ('queued', 'running') RETURNING id`,
    [jobId]
  );
  if (!updated.rowCount) return false;
  await pool.query(
    `INSERT INTO "RenderEvent" ("jobId", phase, percent) VALUES ($1, $2, $3)`,
    [jobId, phase, percent]
  );
  return true;
}

/** Persists a terminal `failed` state once rendering has started. Never overwrites `cancelled`/`complete`. */
async function markFailed(pool: pg.Pool, jobId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE "RenderJob" SET state = 'failed'
        WHERE id = $1 AND state IN ('queued', 'running') RETURNING id`,
      [jobId]
    );
    if (updated.rowCount) {
      await client.query(
        `INSERT INTO "RenderEvent" ("jobId", phase, percent) VALUES ($1, 'failed', 0)`,
        [jobId]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function storedRender(pool: pg.Pool, job: PreviewJob): Promise<{
  snapshot: ProjectSnapshot;
  profile: RenderProfile;
  kind: "preview" | "final";
} | undefined> {
  const result = await pool.query<{
    renderInput: unknown;
    renderProfile: unknown;
    kind: "preview" | "final";
    state: string;
  }>(
    `SELECT "renderInput", "renderProfile", kind, state FROM "RenderJob"
      WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3 AND revision = $4`,
    [job.jobId, job.ownerId, job.projectId, job.revision]
  );
  const row = result.rows[0];
  if (!row || !["queued", "running"].includes(row.state)) return undefined;
  if (!isProjectSnapshot(row.renderInput)
    || row.renderInput.id !== job.projectId
    || row.renderInput.owner_id !== job.ownerId
    || row.renderInput.revision !== job.revision) {
    throw new Error("invalid stored render input");
  }
  if (!(["preview", "final"] as string[]).includes(row.kind) || (job.kind && row.kind !== job.kind)) {
    throw new Error("invalid stored render kind");
  }
  return { snapshot: row.renderInput, profile: validateRenderProfile(row.renderProfile as RenderProfile), kind: row.kind };
}

async function loadSealedMedia(
  pool: pg.Pool,
  store: WorkerObjectStore,
  snapshot: ProjectSnapshot,
  mediaId: string,
  directory: string,
  signal: AbortSignal,
  limits: MediaLimits,
  kind: "scene" | "soundtrack"
): Promise<MediaInput> {
  const result = await pool.query<{
    sealedObjectKey: string;
    sealedEtag: string;
    sealedVersionId: string | null;
    sealedSha256: string;
    declaredType: string;
    maxBytes: number;
    detected: DetectedMedia | null;
  }>(
    `SELECT "sealedObjectKey", "sealedEtag", "sealedVersionId", "sealedSha256",
            "declaredType", "maxBytes", detected FROM "MediaAsset"
      WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3 AND state = 'ready'`,
    [mediaId, snapshot.owner_id, snapshot.id]
  );
  const asset = result.rows[0];
  if (!asset?.sealedObjectKey || !asset.sealedEtag || !asset.sealedSha256) {
    throw new Error(kind === "soundtrack" ? "soundtrack is not sealed" : "scene media is not sealed");
  }
  const path = join(directory, mediaId);
  await store.downloadSealed(asset.sealedObjectKey, path, {
    etag: asset.sealedEtag,
    ...(asset.sealedVersionId ? { versionId: asset.sealedVersionId } : {}),
    sha256: asset.sealedSha256
  }, signal);
  const probed = await probeMediaFile(path, signal, limits.probeTimeoutMs);
  const detected = { ...probed, bytes: (await stat(path)).size };
  if (kind === "soundtrack") {
    if (probed.has_audio !== true) throw new Error("soundtrack has no audio");
    return { path, type: asset.declaredType };
  }
  if (!inspectMedia(asset.declaredType, detected, asset.maxBytes, limits).accepted) {
    throw new Error("media failed render validation");
  }
  return {
    path,
    type: probed.type ?? asset.detected?.type ?? asset.declaredType,
    hasAudio: probed.has_audio === true,
    width: probed.width,
    height: probed.height
  };
}

async function mediaInputsFor(
  pool: pg.Pool,
  store: WorkerObjectStore,
  snapshot: ProjectSnapshot,
  directory: string,
  signal: AbortSignal,
  limits: MediaLimits
): Promise<Record<string, MediaInput>> {
  if (!snapshot.scenes.length) throw new Error("render input has no scenes");
  const inputs: Record<string, MediaInput> = {};
  for (const scene of snapshot.scenes) {
    if (!scene.media_id) throw new Error("scene media is missing");
    if (inputs[scene.media_id]) continue;
    inputs[scene.media_id] = await loadSealedMedia(
      pool, store, snapshot, scene.media_id, directory, signal, limits, "scene"
    );
  }
  const soundtrackId = snapshot.brief.soundtrack?.kind === "upload"
    ? snapshot.brief.soundtrack.media_id
    : undefined;
  if (soundtrackId && !inputs[soundtrackId]) {
    inputs[soundtrackId] = await loadSealedMedia(
      pool, store, snapshot, soundtrackId, directory, signal, limits, "soundtrack"
    );
  }
  return inputs;
}

export function createQueueHandlers(
  pool: pg.Pool,
  store: WorkerObjectStore,
  _legacyProfile?: RenderProfile,
  limits: MediaLimits = defaultMediaLimits,
  env: Record<string, string | undefined> = process.env
): QueueHandlers {
  return {
    async inspect(job: InspectionJob, signal: AbortSignal) {
      let result = await pool.query<{
        quarantineObjectKey: string;
        state: "inspecting" | "ready";
        declaredType: string;
        maxBytes: number;
        detected: DetectedMedia | null;
        inspectionEtag: string | null;
        inspectionVersionId: string | null;
        inspectionSha256: string | null;
        sealedObjectKey: string | null;
        sealedEtag: string | null;
        sealedVersionId: string | null;
        sealedSha256: string | null;
      }>(
        `SELECT "quarantineObjectKey", state, "declaredType", "maxBytes", detected,
                "inspectionEtag", "inspectionVersionId", "inspectionSha256",
                "sealedObjectKey", "sealedEtag", "sealedVersionId", "sealedSha256"
           FROM "MediaAsset"
          WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3
            AND state IN ('inspecting', 'ready')`,
        [job.assetId, job.ownerId, job.projectId]
      );
      let asset = result.rows[0];
      if (!asset) return { state: "ignored" };
      if (asset.state === "ready") {
        await store.delete(asset.quarantineObjectKey);
        return { state: "ready" };
      }

      if (!asset.inspectionSha256) {
        const inspection = await store.inspect(asset.quarantineObjectKey, asset.maxBytes, signal);
        const accepted = inspectMedia(
          asset.declaredType,
          inspection.detected,
          asset.maxBytes,
          limits
        ).accepted;
        if (!accepted) {
          await pool.query(
            `UPDATE "MediaAsset" SET state = 'quarantined', detected = $1
              WHERE id = $2 AND "ownerId" = $3 AND "projectId" = $4 AND state = 'inspecting'`,
            [inspection.detected, job.assetId, job.ownerId, job.projectId]
          );
          await pool.query(
            `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = 'inspection_rejected', "updatedAt" = NOW()
              WHERE "resultMediaId" = $1 AND "ownerId" = $2 AND state = 'inspecting'`,
            [job.assetId, job.ownerId]
          );
          return { state: "quarantined" };
        }
        if (!inspection.identity) throw new Error("inspection identity missing");
        result = await pool.query(
          `UPDATE "MediaAsset"
              SET detected = $1, "inspectionEtag" = $2, "inspectionVersionId" = $3,
                  "inspectionSha256" = $4
            WHERE id = $5 AND "ownerId" = $6 AND "projectId" = $7
              AND state = 'inspecting' AND "inspectionSha256" IS NULL
          RETURNING "quarantineObjectKey", state, "declaredType", "maxBytes", detected,
                    "inspectionEtag", "inspectionVersionId", "inspectionSha256",
                    "sealedObjectKey", "sealedEtag", "sealedVersionId", "sealedSha256"`,
          [
            inspection.detected,
            inspection.identity.etag,
            inspection.identity.versionId ?? null,
            inspection.identity.sha256,
            job.assetId,
            job.ownerId,
            job.projectId
          ]
        );
        asset = result.rows[0];
        if (!asset) throw new Error("inspection state changed");
      }

      if (!asset.inspectionEtag || !asset.inspectionSha256 || !asset.detected) {
        throw new Error("persisted inspection identity missing");
      }
      const sealedObjectKey = `projects/${job.projectId}/media-sealed/${job.assetId}`;
      const sealed = await store.seal(asset.quarantineObjectKey, sealedObjectKey, {
        etag: asset.inspectionEtag,
        ...(asset.inspectionVersionId ? { versionId: asset.inspectionVersionId } : {}),
        sha256: asset.inspectionSha256
      }, signal);
      const ready = await pool.query(
        `UPDATE "MediaAsset"
            SET state = 'ready', "sealedObjectKey" = $1, "sealedEtag" = $2,
                "sealedVersionId" = $3, "sealedSha256" = $4
          WHERE id = $5 AND "ownerId" = $6 AND "projectId" = $7
            AND state = 'inspecting' AND "inspectionSha256" = $4`,
        [
          sealedObjectKey,
          sealed.etag,
          sealed.versionId ?? null,
          sealed.sha256,
          job.assetId,
          job.ownerId,
          job.projectId
        ]
      );
      if (ready.rowCount !== 1) throw new Error("media seal state changed");
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'ready', "updatedAt" = NOW()
          WHERE "resultMediaId" = $1 AND "ownerId" = $2 AND state = 'inspecting'`,
        [job.assetId, job.ownerId]
      );
      await store.delete(asset.quarantineObjectKey);
      return { state: "ready" };
    },
    async generateFalImage(job, signal) {
      return processFalImageJob(pool, store, job, signal, env);
    },
    async generateFalVideo(job, signal) {
      return processFalVideoJob(pool, store, job, signal, env);
    },
    async render(job: PreviewJob, signal: AbortSignal) {
      let stored: Awaited<ReturnType<typeof storedRender>>;
      try {
        stored = await storedRender(pool, job);
      } catch (error) {
        console.error(`render ${job.jobId} failed: ${error instanceof Error ? error.message : "error"}`);
        await markFailed(pool, job.jobId);
        return { state: "failed" };
      }
      if (!stored || !await event(pool, job.jobId, "preparing", 10)) return { state: "cancelled" };
      const { snapshot, profile, kind } = stored;
      const directory = await mkdtemp(join(tmpdir(), `fengine-${job.jobId}-`));
      const output = join(directory, "preview.mp4");
      let uploadedObjectKey: string | undefined;
      try {
        try {
          const mediaInputs = await mediaInputsFor(pool, store, snapshot, directory, signal, limits);
          if (!await event(pool, job.jobId, "rendering", 35)) return { state: "cancelled" };
          await renderPreview(output, snapshot, signal, mediaInputs, profile);
          const measured = await probeMediaFile(output, signal, limits.probeTimeoutMs);
          const expectedDuration = snapshot.scenes.reduce((total, scene) => total + scene.duration_ms, 0);
          if (measured.width !== profile.width || measured.height !== profile.height
            || !measured.duration_ms || Math.abs(measured.duration_ms - expectedDuration) > 250) {
            throw new Error("render output does not match immutable profile");
          }
          if (!await event(pool, job.jobId, "uploading", 85)) return { state: "cancelled" };
          const revisionKey = renderObjectKey(job.projectId, job.revision).replace(/\.mp4$/, "");
          const objectKey = `${revisionKey}/${job.jobId}/${randomUUID()}.mp4`;
          const { size } = await stat(output);
          const upload = createReadStream(output);
          try {
            await store.put(objectKey, upload, "video/mp4", size, signal);
            uploadedObjectKey = objectKey;
          } finally {
            upload.destroy();
            await finished(upload).catch(() => undefined);
          }
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const active = await client.query(
              `SELECT 1 FROM "RenderJob" WHERE id = $1 AND state = 'running' FOR UPDATE`,
              [job.jobId]
            );
            if (!active.rowCount) throw new RenderCompletionRefusedError();
            const inserted = await client.query(
              `INSERT INTO "RenderResult" (id, "jobId", "objectKey", metadata)
               VALUES ($1, $2, $3, $4) ON CONFLICT ("jobId") DO NOTHING`,
              [randomUUID(), job.jobId, objectKey, {
                width: measured.width,
                height: measured.height,
                duration_ms: measured.duration_ms,
                video_codec: measured.video_codec,
                pixel_format: measured.pixel_format,
                audio_codec: measured.audio_codec,
                audio_channels: measured.audio_channels,
                audio_status: measured.has_audio ? "present" : "silent",
                scene_count: snapshot.scenes.length,
                kind,
                render_profile: profile,
                revision: job.revision,
                immutable: true
              }]
            );
            if (!inserted.rowCount) throw new RenderCompletionRefusedError();
            await client.query(`UPDATE "RenderJob" SET state = 'complete' WHERE id = $1`, [job.jobId]);
            await client.query(
              `INSERT INTO "RenderEvent" ("jobId", phase, percent) VALUES ($1, 'complete', 100)`,
              [job.jobId]
            );
            await client.query("COMMIT");
            uploadedObjectKey = undefined;
            return { state: "complete", objectKey };
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        } catch (error) {
          let cleanupError: unknown;
          if (uploadedObjectKey) {
            try {
              await store.delete(uploadedObjectKey);
            } catch (caught) {
              cleanupError = caught;
            }
          }
          // Rendering had already started (past `preparing`): treat every failure here as
          // terminal so the client SSE stops waiting instead of polling to the 15m ceiling.
          await markFailed(pool, job.jobId);
          console.error(`render ${job.jobId} failed: ${error instanceof Error ? error.message : "error"}`);
          if (cleanupError) throw cleanupError;
          if (error instanceof RenderCompletionRefusedError) return { state: "cancelled" };
          return { state: "failed" };
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  };
}
