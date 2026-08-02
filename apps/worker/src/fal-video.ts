import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type pg from "pg";
import {
  FAL_VIDEO_ENDPOINT_ID,
  FAL_VIDEO_MAX_BYTES,
  assertFalVideoMediaUrl,
  cancelVideo,
  credentialVaultFromEnv,
  decryptCredential,
  submitVideo,
  videoResult,
  videoStatus,
  type EncryptedCredential
} from "@f-engine/fal-host";
import type { WorkerObjectStore } from "./runtime.js";

const POLL_CEILING_MS = 20 * 60_000;

export interface FalVideoJob {
  generationJobId: string;
  ownerId: string;
  projectId: string;
}

interface GenerationRow {
  id: string;
  ownerId: string;
  projectId: string;
  sceneId: string;
  credentialId: string;
  sourceMediaId: string | null;
  prompt: string;
  inputJson: {
    source_media_id: string;
    sealed_sha256: string;
    declared_type: string;
    width: number;
    height: number;
    bytes: number;
    duration: string;
    motion_prompt: string;
  };
  state: string;
  cancelRequested: boolean;
  providerRequestId: string | null;
  resultMediaId: string | null;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

async function loadJob(pool: pg.Pool, job: FalVideoJob): Promise<GenerationRow | undefined> {
  const result = await pool.query<GenerationRow>(
    `SELECT g.id, g."ownerId", g."projectId", g."sceneId", g."credentialId", g."sourceMediaId", g.prompt,
            g."inputJson", g.state, g."cancelRequested", g."providerRequestId", g."resultMediaId",
            c.ciphertext, c.nonce, c."authTag", c."keyVersion"
       FROM "GenerationJob" g
       JOIN "ProviderCredential" c ON c.id = g."credentialId" AND c."ownerId" = g."ownerId"
      WHERE g.id = $1 AND g."ownerId" = $2 AND g."projectId" = $3 AND g.kind = 'image_to_video'`,
    [job.generationJobId, job.ownerId, job.projectId]
  );
  return result.rows[0];
}

function apiKey(row: GenerationRow, env: Record<string, string | undefined>): string {
  const vault = credentialVaultFromEnv(env);
  const encrypted: EncryptedCredential = {
    ciphertext: row.ciphertext,
    nonce: row.nonce,
    authTag: row.authTag,
    keyVersion: row.keyVersion
  };
  return decryptCredential(encrypted, {
    id: row.credentialId,
    ownerId: row.ownerId,
    provider: "fal"
  }, vault);
}

async function downloadVideo(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<{ path: string; bytes: number; contentType: string; directory: string }> {
  assertFalVideoMediaUrl(url);
  const response = await fetchImpl(url, { redirect: "error", signal });
  if (!response.ok || !response.body) throw new Error("download failed");
  const contentType = ((response.headers.get("content-type") ?? "").split(";")[0] ?? "").trim().toLowerCase();
  if (contentType !== "video/mp4") throw new Error("unsupported video type");
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > FAL_VIDEO_MAX_BYTES) throw new Error("video too large");
  const directory = join(tmpdir(), `fal-video-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "clip.mp4");
  let bytes = 0;
  const capped = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > FAL_VIDEO_MAX_BYTES) {
        controller.error(new Error("video too large"));
        return;
      }
      controller.enqueue(chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(capped) as never), createWriteStream(path));
  return { path, bytes, contentType, directory };
}

/** Durable FAL image-to-video worker. At most one provider submit per job. */
export async function processFalVideoJob(
  pool: pg.Pool,
  store: WorkerObjectStore,
  job: FalVideoJob,
  signal: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  let row = await loadJob(pool, job);
  if (!row) return { state: "ignored" };
  if (["ready", "cancelled", "failed", "submission_uncertain"].includes(row.state)) {
    return { state: row.state };
  }

  if (row.state === "submitting" && !row.providerRequestId) {
    // ponytail: crash after provider accept / before ID persist. Ceiling is manual
    // FAL dashboard check; never auto-resubmit (duplicate spend). Upgrade if FAL
    // documents idempotent submit or client-selected request IDs.
    await pool.query(
      `UPDATE "GenerationJob" SET state = 'submission_uncertain', "failureCode" = 'submission_uncertain', "updatedAt" = NOW()
        WHERE id = $1 AND "ownerId" = $2 AND state = 'submitting' AND "providerRequestId" IS NULL`,
      [job.generationJobId, job.ownerId]
    );
    return { state: "submission_uncertain" };
  }

  if (row.state === "queued") {
    const claimed = await pool.query(
      `UPDATE "GenerationJob" SET state = 'submitting', "updatedAt" = NOW()
        WHERE id = $1 AND "ownerId" = $2 AND state = 'queued'
        RETURNING id`,
      [job.generationJobId, job.ownerId]
    );
    if (!claimed.rowCount) return { state: "ignored" };
    row = (await loadJob(pool, job))!;
    if (row.cancelRequested) {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'cancelled', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2`,
        [job.generationJobId, job.ownerId]
      );
      return { state: "cancelled" };
    }
    const source = await pool.query<{
      sealedObjectKey: string | null;
      sealedSha256: string | null;
      sealedEtag: string | null;
      sealedVersionId: string | null;
      state: string;
    }>(
      `SELECT "sealedObjectKey", "sealedSha256", "sealedEtag", "sealedVersionId", state
         FROM "MediaAsset"
        WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3`,
      [row.sourceMediaId, job.ownerId, job.projectId]
    );
    const asset = source.rows[0];
    if (!asset || asset.state !== "ready" || !asset.sealedObjectKey || !asset.sealedSha256
      || asset.sealedSha256 !== row.inputJson.sealed_sha256 || !asset.sealedEtag) {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = 'source_changed', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2`,
        [job.generationJobId, job.ownerId]
      );
      return { state: "failed" };
    }
    // Signed URL is created only for this outbound submit and never persisted.
    const imageUrl = await store.signedGet(asset.sealedObjectKey, 3600);
    const key = apiKey(row, env);
    const submitted = await submitVideo(
      key,
      { prompt: row.prompt, imageUrl },
      fetchImpl,
      30_000,
      signal
    );
    await pool.query(
      `UPDATE "GenerationJob"
          SET "providerRequestId" = $1, state = 'running', "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND state = 'submitting'`,
      [submitted.request_id, job.generationJobId, job.ownerId]
    );
    row = (await loadJob(pool, job))!;
  }

  if (!row.providerRequestId) return { state: row.state };
  const key = apiKey(row, env);
  const deadline = Date.now() + POLL_CEILING_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("aborted");
    row = (await loadJob(pool, job))!;
    if (!row) return { state: "ignored" };
    if (row.cancelRequested) {
      await cancelVideo(key, row.providerRequestId!, fetchImpl, 15_000, signal).catch(() => undefined);
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'cancelled', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2 AND state IN ('running', 'submitting', 'downloading')`,
        [job.generationJobId, job.ownerId]
      );
      return { state: "cancelled" };
    }
    const status = await videoStatus(key, row.providerRequestId!, fetchImpl, 30_000, signal);
    if (status.status === "FAILED") {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = $1, "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3`,
        [status.failureCode, job.generationJobId, job.ownerId]
      );
      return { state: "failed" };
    }
    if (status.status === "COMPLETED") break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  row = (await loadJob(pool, job))!;
  if (!row?.providerRequestId) return { state: "ignored" };
  await pool.query(
    `UPDATE "GenerationJob" SET state = 'downloading', "updatedAt" = NOW()
      WHERE id = $1 AND "ownerId" = $2 AND state = 'running'`,
    [job.generationJobId, job.ownerId]
  );
  const result = await videoResult(key, row.providerRequestId, fetchImpl, 30_000, signal);
  const clip = await downloadVideo(result.url, signal, fetchImpl);
  const assetId = randomUUID();
  const quarantineObjectKey = `private/${job.ownerId}/${job.projectId}/quarantine/${assetId}`;
  try {
    await store.put(quarantineObjectKey, createReadStream(clip.path), clip.contentType, clip.bytes, signal);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO "MediaAsset"
           (id, "ownerId", "projectId", "quarantineObjectKey", state, "declaredType", "maxBytes", attribution)
         VALUES ($1,$2,$3,$4,'inspecting',$5,$6,$7)`,
        [
          assetId, job.ownerId, job.projectId, quarantineObjectKey, clip.contentType, clip.bytes,
          JSON.stringify({
            source: "FAL",
            model: FAL_VIDEO_ENDPOINT_ID,
            generationJobId: job.generationJobId,
            derivedFromMediaId: row.sourceMediaId,
            generatedAt: new Date().toISOString()
          })
        ]
      );
      await client.query(
        `UPDATE "GenerationJob"
            SET state = 'inspecting', "resultMediaId" = $1, "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3`,
        [assetId, job.generationJobId, job.ownerId]
      );
      await client.query(
        `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
         VALUES ($1, 'inspect-media', $2, $3)
         ON CONFLICT ("dedupeKey") DO NOTHING`,
        [
          randomUUID(),
          `inspect-media:${assetId}`,
          JSON.stringify({ assetId, ownerId: job.ownerId, projectId: job.projectId })
        ]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await store.delete(quarantineObjectKey).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await rm(clip.directory, { recursive: true, force: true }).catch(() => undefined);
  }
  return { state: "inspecting", assetId };
}
