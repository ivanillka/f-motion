import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { ProjectSnapshot, Scene } from "@f-engine/contracts";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  validateRenderProfile,
  type RenderProfile
} from "@f-engine/reel-engine";
import {
  inspectMedia,
  probeMediaFile,
  renderObjectKey,
  renderPreview,
  type DetectedMedia,
  type MediaInput
} from "./index.js";
import type { InspectionJob, PreviewJob, QueueHandlers } from "./queue.js";

interface WorkerObjectStore {
  inspect(objectKey: string, maxBytes: number): Promise<DetectedMedia>;
  download(objectKey: string, destination: string): Promise<void>;
  put(objectKey: string, body: Uint8Array, contentType: string): Promise<void>;
}

export function renderProfileFromEnv(
  env: Record<string, string | undefined>
): RenderProfile {
  const watermark = env.RENDER_WATERMARK?.trim();
  return validateRenderProfile({
    width: Number(env.RENDER_WIDTH ?? "720"),
    height: Number(env.RENDER_HEIGHT ?? "1280"),
    ...(watermark ? { watermark } : {})
  });
}

export class S3WorkerObjectStore implements WorkerObjectStore {
  constructor(readonly client: S3Client, readonly bucket: string) {}

  async inspect(objectKey: string, maxBytes: number): Promise<DetectedMedia> {
    const head = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: objectKey
    }));
    const bytes = Number(head.ContentLength ?? 0);
    if (bytes <= 0) return { type: "application/octet-stream", bytes: 0 };
    if (bytes > maxBytes) return { type: "application/octet-stream", bytes };

    const directory = await mkdtemp(join(tmpdir(), "fengine-inspect-"));
    const path = join(directory, "object");
    try {
      await this.download(objectKey, path);
      const probed = await probeMediaFile(path);
      return { ...probed, bytes };
    } catch {
      return { type: "application/octet-stream", bytes };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async download(objectKey: string, destination: string): Promise<void> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey
    }));
    if (!result.Body) throw new Error("object body missing");
    await pipeline(result.Body as Readable, createWriteStream(destination));
  }

  async put(objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType
    }));
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

async function projectSnapshot(pool: pg.Pool, job: PreviewJob): Promise<ProjectSnapshot | undefined> {
  const project = await pool.query<{
    id: string;
    ownerId: string;
    revision: number;
    brief: ProjectSnapshot["brief"];
    state: string;
  }>(
    `SELECT p.id, p."ownerId", p.revision, p.brief, j.state
       FROM "RenderJob" j JOIN "Project" p ON p.id = j."projectId"
      WHERE j.id = $1 AND j."ownerId" = $2 AND j."projectId" = $3 AND j.revision = $4`,
    [job.jobId, job.ownerId, job.projectId, job.revision]
  );
  const row = project.rows[0];
  if (!row || row.state === "cancelled") return undefined;
  const scenes = await pool.query<{ position: number; payload: Scene }>(
    `SELECT position, payload FROM "Scene" WHERE "projectId" = $1 ORDER BY position`,
    [job.projectId]
  );
  return {
    schema_version: 1,
    id: row.id,
    owner_id: row.ownerId,
    revision: job.revision,
    brief: row.brief,
    scenes: scenes.rows.map(({ position, payload }) => ({ ...payload, order: position }))
  };
}

async function mediaInputsFor(
  pool: pg.Pool,
  store: WorkerObjectStore,
  snapshot: ProjectSnapshot,
  directory: string
): Promise<Record<string, MediaInput>> {
  const inputs: Record<string, MediaInput> = {};
  for (const scene of snapshot.scenes) {
    if (!scene.media_id || inputs[scene.media_id]) continue;
    const result = await pool.query<{
      objectKey: string;
      declaredType: string;
      detected: DetectedMedia | null;
    }>(
      `SELECT "objectKey", "declaredType", detected FROM "MediaAsset"
        WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3 AND state = 'ready'`,
      [scene.media_id, snapshot.owner_id, snapshot.id]
    );
    const asset = result.rows[0];
    if (!asset) continue;
    const path = join(directory, scene.media_id);
    await store.download(asset.objectKey, path);
    const probed = await probeMediaFile(path);
    inputs[scene.media_id] = {
      path,
      type: probed.type ?? asset.detected?.type ?? asset.declaredType,
      hasAudio: probed.has_audio === true
    };
  }
  return inputs;
}

export function createQueueHandlers(
  pool: pg.Pool,
  store: WorkerObjectStore,
  profile: RenderProfile
): QueueHandlers {
  return {
    async inspect(job: InspectionJob) {
      const result = await pool.query<{
        objectKey: string;
        declaredType: string;
        maxBytes: number;
      }>(
        `SELECT "objectKey", "declaredType", "maxBytes" FROM "MediaAsset"
          WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3 AND state = 'inspecting'`,
        [job.assetId, job.ownerId, job.projectId]
      );
      const asset = result.rows[0];
      if (!asset) return { state: "ignored" };
      const detected = await store.inspect(asset.objectKey, asset.maxBytes);
      const accepted = inspectMedia(asset.declaredType, detected, asset.maxBytes).accepted;
      const state = accepted ? "ready" : "quarantined";
      await pool.query(
        `UPDATE "MediaAsset" SET state = $1, detected = $2
          WHERE id = $3 AND "ownerId" = $4 AND "projectId" = $5`,
        [state, detected, job.assetId, job.ownerId, job.projectId]
      );
      return { state };
    },
    async render(job: PreviewJob, signal: AbortSignal) {
      const snapshot = await projectSnapshot(pool, job);
      if (!snapshot || !await event(pool, job.jobId, "preparing", 10)) return { state: "cancelled" };
      const directory = await mkdtemp(join(tmpdir(), `fengine-${job.jobId}-`));
      const output = join(directory, "preview.mp4");
      try {
        try {
          const mediaInputs = await mediaInputsFor(pool, store, snapshot, directory);
          if (!await event(pool, job.jobId, "rendering", 35)) return { state: "cancelled" };
          await renderPreview(output, snapshot, signal, mediaInputs, profile);
          if (!await event(pool, job.jobId, "uploading", 85)) return { state: "cancelled" };
          const objectKey = renderObjectKey(job.projectId, job.revision);
          await store.put(objectKey, await readFile(output), "video/mp4");
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            const active = await client.query(
              `SELECT 1 FROM "RenderJob" WHERE id = $1 AND state = 'running' FOR UPDATE`,
              [job.jobId]
            );
            if (!active.rowCount) {
              await client.query("ROLLBACK");
              return { state: "cancelled" };
            }
            await client.query(
              `INSERT INTO "RenderResult" (id, "jobId", "objectKey", metadata)
               VALUES ($1, $2, $3, $4) ON CONFLICT ("jobId") DO NOTHING`,
              [randomUUID(), job.jobId, objectKey, {
                width: profile.width,
                height: profile.height,
                ...(profile.watermark ? { watermark: profile.watermark } : {}),
                revision: job.revision,
                immutable: true
              }]
            );
            await client.query(`UPDATE "RenderJob" SET state = 'complete' WHERE id = $1`, [job.jobId]);
            await client.query(
              `INSERT INTO "RenderEvent" ("jobId", phase, percent) VALUES ($1, 'complete', 100)`,
              [job.jobId]
            );
            await client.query("COMMIT");
            return { state: "complete", objectKey };
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        } catch {
          // Rendering had already started (past `preparing`): treat every failure here as
          // terminal so the client SSE stops waiting instead of polling to the 15m ceiling.
          await markFailed(pool, job.jobId);
          return { state: "failed" };
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  };
}
