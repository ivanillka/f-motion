import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type pg from "pg";
import {
  FAL_SPEECH_ENDPOINT_ID,
  FAL_SPEECH_MAX_BYTES,
  FalImageError,
  assertFalMediaUrl,
  cancelSpeech,
  credentialVaultFromEnv,
  decryptCredential,
  runSpeech,
  speechResult,
  speechStatus,
  type EncryptedCredential
} from "@f-engine/fal-host";
import type { WorkerObjectStore } from "./runtime.js";

/** Legacy queue jobs only. New Kokoro runs are blocking and skip this loop. */
const POLL_CEILING_MS = 20_000;
const SPEECH_RUN_TIMEOUT_MS = 45_000;

export interface FalSpeechJob {
  generationJobId: string;
  ownerId: string;
  projectId: string;
}

interface GenerationRow {
  id: string;
  ownerId: string;
  projectId: string;
  sceneId: string;
  credentialId: string | null;
  prompt: string;
  state: string;
  cancelRequested: boolean;
  providerRequestId: string | null;
  resultMediaId: string | null;
  ciphertext: Buffer | null;
  nonce: Buffer | null;
  authTag: Buffer | null;
  keyVersion: number | null;
}

function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
}

async function loadJob(pool: pg.Pool, job: FalSpeechJob): Promise<GenerationRow | undefined> {
  const result = await pool.query<GenerationRow>(
    `SELECT g.id, g."ownerId", g."projectId", g."sceneId", g."credentialId", g.prompt, g.state,
            g."cancelRequested", g."providerRequestId", g."resultMediaId",
            c.ciphertext, c.nonce, c."authTag", c."keyVersion"
       FROM "GenerationJob" g
       LEFT JOIN "ProviderCredential" c ON c.id = g."credentialId" AND c."ownerId" = g."ownerId"
      WHERE g.id = $1 AND g."ownerId" = $2 AND g."projectId" = $3 AND g.kind = 'speech'`,
    [job.generationJobId, job.ownerId, job.projectId]
  );
  return result.rows[0];
}

function hasCredential(row: GenerationRow): row is GenerationRow & {
  credentialId: string;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
} {
  return Boolean(row.credentialId && row.ciphertext && row.nonce && row.authTag && row.keyVersion != null);
}

async function failMissingCredential(pool: pg.Pool, job: FalSpeechJob): Promise<Record<string, unknown>> {
  await pool.query(
    `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = 'fal_not_connected', "updatedAt" = NOW()
      WHERE id = $1 AND "ownerId" = $2 AND state NOT IN ('ready', 'cancelled', 'failed', 'submission_uncertain')`,
    [job.generationJobId, job.ownerId]
  );
  return { state: "failed" };
}

function apiKey(row: GenerationRow & {
  credentialId: string;
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
}, env: Record<string, string | undefined>): string {
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

async function downloadWav(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<{ path: string; bytes: number; directory: string }> {
  assertFalMediaUrl(url);
  const response = await fetchImpl(url, { redirect: "error", signal });
  if (!response.ok || !response.body) throw new Error("download failed");
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > FAL_SPEECH_MAX_BYTES) throw new Error("audio too large");
  const directory = join(tmpdir(), `fal-speech-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const path = join(directory, "voice.wav");
  let bytes = 0;
  const capped = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > FAL_SPEECH_MAX_BYTES) {
        controller.error(new Error("audio too large"));
        return;
      }
      controller.enqueue(chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(capped) as never), createWriteStream(path));
  return { path, bytes, directory };
}

/** Durable FAL speech worker. At most one provider submit per job. WAV skips inspect-media. */
export async function processFalSpeechJob(
  pool: pg.Pool,
  store: WorkerObjectStore,
  job: FalSpeechJob,
  signal: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  pollCeilingMs: number = POLL_CEILING_MS
): Promise<Record<string, unknown>> {
  try {
    return await runFalSpeechJob(pool, store, job, signal, env, fetchImpl, pollCeilingMs);
  } catch (error) {
    if (signal.aborted) throw error;
    const code = error instanceof FalImageError ? error.code : "provider_unavailable";
    await pool.query(
      `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3
          AND state NOT IN ('ready', 'cancelled', 'failed', 'submission_uncertain')`,
      [code, job.generationJobId, job.ownerId]
    );
    return { state: "failed" };
  }
}

async function runFalSpeechJob(
  pool: pg.Pool,
  store: WorkerObjectStore,
  job: FalSpeechJob,
  signal: AbortSignal,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
  pollCeilingMs: number
): Promise<Record<string, unknown>> {
  let row = await loadJob(pool, job);
  if (!row) return { state: "ignored" };
  if (["ready", "cancelled", "failed", "submission_uncertain"].includes(row.state)) {
    return { state: row.state };
  }
  if (row.resultMediaId) return { state: row.state };
  if (!hasCredential(row)) return failMissingCredential(pool, job);

  if (row.state === "submitting" && !row.providerRequestId) {
    // ponytail: crash during blocking fal.run or before WAV persist. Ceiling is
    // a FAL dashboard check; never auto-resubmit (duplicate spend).
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
    if (!row) return { state: "ignored" };
    if (row.cancelRequested) {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'cancelled', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2`,
        [job.generationJobId, job.ownerId]
      );
      return { state: "cancelled" };
    }
    if (!hasCredential(row)) return failMissingCredential(pool, job);
    const generated = await runSpeech(
      apiKey(row, env),
      { prompt: row.prompt },
      fetchImpl,
      SPEECH_RUN_TIMEOUT_MS,
      signal
    );
    row = (await loadJob(pool, job))!;
    if (!row) return { state: "ignored" };
    if (row.cancelRequested) {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'cancelled', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2 AND state IN ('running', 'submitting', 'downloading')`,
        [job.generationJobId, job.ownerId]
      );
      return { state: "cancelled" };
    }
    await pool.query(
      `UPDATE "GenerationJob" SET state = 'downloading', "updatedAt" = NOW()
        WHERE id = $1 AND "ownerId" = $2 AND state IN ('running', 'submitting')`,
      [job.generationJobId, job.ownerId]
    );
    return persistSpeechWav(pool, store, job, generated.url, signal, fetchImpl);
  }

  if (!row.providerRequestId) return { state: row.state };
  if (!hasCredential(row)) return failMissingCredential(pool, job);
  const queuedUrl = await pollLegacySpeechUrl(
    pool,
    job,
    apiKey(row, env),
    row.providerRequestId,
    signal,
    fetchImpl,
    pollCeilingMs
  );
  if (!queuedUrl) {
    row = (await loadJob(pool, job))!;
    return { state: row?.state ?? "ignored" };
  }
  await pool.query(
    `UPDATE "GenerationJob" SET state = 'downloading', "updatedAt" = NOW()
      WHERE id = $1 AND "ownerId" = $2 AND state IN ('running', 'submitting')`,
    [job.generationJobId, job.ownerId]
  );
  return persistSpeechWav(pool, store, job, queuedUrl, signal, fetchImpl);
}

async function pollLegacySpeechUrl(
  pool: pg.Pool,
  job: FalSpeechJob,
  key: string,
  requestId: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
  pollCeilingMs: number
): Promise<string | undefined> {
  try {
    const immediate = await speechResult(key, requestId, fetchImpl, 30_000, signal);
    return immediate.url;
  } catch (error) {
    if (!(error instanceof FalImageError) || (error.code !== "provider_unavailable" && error.code !== "rate_limited")) {
      throw error;
    }
  }
  let completed = false;
  const deadline = Date.now() + pollCeilingMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("aborted");
    const current = await loadJob(pool, job);
    if (!current) return undefined;
    if (current.cancelRequested) {
      await cancelSpeech(key, requestId, fetchImpl, 15_000, signal).catch(() => undefined);
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'cancelled', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2 AND state IN ('running', 'submitting', 'downloading')`,
        [job.generationJobId, job.ownerId]
      );
      return undefined;
    }
    let status;
    try {
      status = await speechStatus(key, requestId, fetchImpl, 30_000, signal);
    } catch (error) {
      if (!(error instanceof FalImageError) || (error.code !== "provider_unavailable" && error.code !== "rate_limited")) {
        throw error;
      }
      await pool.query(
        `UPDATE "GenerationJob" SET "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2 AND state = 'running'`,
        [job.generationJobId, job.ownerId]
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    if (status.status === "FAILED") {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = $1, "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3`,
        [status.failureCode, job.generationJobId, job.ownerId]
      );
      return undefined;
    }
    if (status.status === "COMPLETED") {
      completed = true;
      break;
    }
    await pool.query(
      `UPDATE "GenerationJob" SET "updatedAt" = NOW()
        WHERE id = $1 AND "ownerId" = $2 AND state = 'running'`,
      [job.generationJobId, job.ownerId]
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!completed) {
    await pool.query(
      `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND state IN ('running', 'submitting', 'downloading')`,
      ["poll_timeout", job.generationJobId, job.ownerId]
    );
    return undefined;
  }
  const result = await speechResult(key, requestId, fetchImpl, 30_000, signal);
  return result.url;
}

async function persistSpeechWav(
  pool: pg.Pool,
  store: WorkerObjectStore,
  job: FalSpeechJob,
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const wav = await downloadWav(url, signal, fetchImpl);
  const bytes = await readFile(wav.path);
  if (!isWav(bytes.subarray(0, 12))) throw new Error("unsupported audio type");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const assetId = randomUUID();
  const sealedObjectKey = `projects/${job.projectId}/media-sealed/${assetId}`;
  const quarantineObjectKey = `projects/${job.projectId}/media-quarantine/${assetId}`;
  try {
    const uploaded = await store.put(sealedObjectKey, bytes, "audio/wav", bytes.byteLength, signal);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO "MediaAsset"
           (id, "ownerId", "projectId", "quarantineObjectKey", "sealedObjectKey", "sealedEtag",
            "sealedVersionId", "sealedSha256", state, "declaredType", "maxBytes", detected, attribution)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ready',$9,$10,$11,$12)`,
        [
          assetId, job.ownerId, job.projectId, quarantineObjectKey, sealedObjectKey,
          uploaded.etag, uploaded.versionId ?? null, sha256, "audio/wav", bytes.byteLength,
          JSON.stringify({ type: "audio/wav", bytes: bytes.byteLength }),
          JSON.stringify({
            source: "FAL",
            model: FAL_SPEECH_ENDPOINT_ID,
            generationJobId: job.generationJobId,
            generatedAt: new Date().toISOString()
          })
        ]
      );
      await client.query(
        `UPDATE "GenerationJob"
            SET state = 'ready', "resultMediaId" = $1, "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3`,
        [assetId, job.generationJobId, job.ownerId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await store.delete(sealedObjectKey).catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await rm(wav.directory, { recursive: true, force: true }).catch(() => undefined);
  }
  return { state: "ready", assetId };
}
