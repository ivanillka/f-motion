import type pg from "pg";
import {
  FAL_STILL_ANALYZE_ENDPOINT_ID,
  FAL_VIDEO_ANALYZE_ENDPOINT_ID,
  analyzeResult,
  analyzeStatus,
  cancelAnalyze,
  credentialVaultFromEnv,
  decryptCredential,
  falStillAnalyzeInput,
  falVideoAnalyzeInput,
  parseStoryFromAnalysis,
  submitAnalyze,
  type EncryptedCredential,
  type FalStoryFromMedia
} from "@f-engine/fal-host";
import type { WorkerObjectStore } from "./runtime.js";

const POLL_CEILING_MS = 10 * 60_000;

export interface FalAnalyzeJob {
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
  sourceMediaId: string | null;
  endpointId: string;
  inputJson: {
    source_media_id: string;
    sealed_sha256: string;
    declared_type: string;
    bytes: number;
    duration_ms?: number;
    analysis?: FalStoryFromMedia;
  };
  state: string;
  cancelRequested: boolean;
  providerRequestId: string | null;
  ciphertext: Buffer | null;
  nonce: Buffer | null;
  authTag: Buffer | null;
  keyVersion: number | null;
}

async function loadJob(pool: pg.Pool, job: FalAnalyzeJob): Promise<GenerationRow | undefined> {
  const result = await pool.query<GenerationRow>(
    `SELECT g.id, g."ownerId", g."projectId", g."sceneId", g."credentialId", g."sourceMediaId",
            g."endpointId", g."inputJson", g.state, g."cancelRequested", g."providerRequestId",
            c.ciphertext, c.nonce, c."authTag", c."keyVersion"
       FROM "GenerationJob" g
       LEFT JOIN "ProviderCredential" c ON c.id = g."credentialId" AND c."ownerId" = g."ownerId"
      WHERE g.id = $1 AND g."ownerId" = $2 AND g."projectId" = $3 AND g.kind = 'analyze'`,
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

async function failMissingCredential(pool: pg.Pool, job: FalAnalyzeJob): Promise<Record<string, unknown>> {
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

/** Durable FAL media-analysis worker. At most one provider submit per job. */
export async function processFalAnalyzeJob(
  pool: pg.Pool,
  store: WorkerObjectStore,
  job: FalAnalyzeJob,
  signal: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  pollCeilingMs: number = POLL_CEILING_MS
): Promise<Record<string, unknown>> {
  let row = await loadJob(pool, job);
  if (!row) return { state: "ignored" };
  if (["ready", "cancelled", "failed", "submission_uncertain"].includes(row.state)) {
    return { state: row.state };
  }
  if (row.inputJson.analysis) {
    if (row.state !== "ready") {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'ready', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2 AND state NOT IN ('ready', 'cancelled', 'failed', 'submission_uncertain')`,
        [job.generationJobId, job.ownerId]
      );
    }
    return { state: "ready" };
  }
  if (!hasCredential(row)) return failMissingCredential(pool, job);

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
    const source = await pool.query<{
      sealedObjectKey: string | null;
      sealedSha256: string | null;
      sealedEtag: string | null;
      state: string;
    }>(
      `SELECT "sealedObjectKey", "sealedSha256", "sealedEtag", state
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
    const mediaUrl = await store.signedGet(asset.sealedObjectKey, 3600);
    const key = apiKey(row, env);
    const isVideo = row.endpointId === FAL_VIDEO_ANALYZE_ENDPOINT_ID;
    const submitted = await submitAnalyze(
      key,
      row.endpointId,
      isVideo ? falVideoAnalyzeInput(mediaUrl) : falStillAnalyzeInput(mediaUrl),
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
    if (!row) return { state: "ignored" };
  }

  if (!row.providerRequestId) return { state: row.state };
  if (!hasCredential(row)) return failMissingCredential(pool, job);
  const key = apiKey(row, env);
  let completed = false;
  const deadline = Date.now() + pollCeilingMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error("aborted");
    row = (await loadJob(pool, job))!;
    if (!row) return { state: "ignored" };
    if (row.cancelRequested) {
      await cancelAnalyze(key, row.endpointId, row.providerRequestId!, fetchImpl, 15_000, signal).catch(() => undefined);
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'cancelled', "updatedAt" = NOW()
          WHERE id = $1 AND "ownerId" = $2 AND state IN ('running', 'submitting')`,
        [job.generationJobId, job.ownerId]
      );
      return { state: "cancelled" };
    }
    const status = await analyzeStatus(key, row.endpointId, row.providerRequestId!, fetchImpl, 30_000, signal);
    if (status.status === "FAILED") {
      await pool.query(
        `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = $1, "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3`,
        [status.failureCode, job.generationJobId, job.ownerId]
      );
      return { state: "failed" };
    }
    if (status.status === "COMPLETED") {
      completed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!completed) {
    await pool.query(
      `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND state IN ('running', 'submitting')`,
      ["poll_timeout", job.generationJobId, job.ownerId]
    );
    return { state: "failed" };
  }

  row = (await loadJob(pool, job))!;
  if (!row?.providerRequestId) return { state: "ignored" };
  const result = await analyzeResult(key, row.endpointId, row.providerRequestId, fetchImpl, 30_000, signal);
  const analysis = parseStoryFromAnalysis(result.output);
  await pool.query(
    `UPDATE "GenerationJob"
        SET state = 'ready', "inputJson" = $1, "updatedAt" = NOW()
      WHERE id = $2 AND "ownerId" = $3 AND state IN ('running', 'submitting')`,
    [JSON.stringify({ ...row.inputJson, analysis }), job.generationJobId, job.ownerId]
  );
  return { state: "ready", analysis };
}
