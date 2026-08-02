import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  FAL_IMAGE_ENDPOINT_ID,
  FalImageError,
  estimateImage,
  falImageInput,
  type FalImageQuote
} from "@f-engine/fal-host";
import { sceneMediaView, type SceneMediaView, type StoredMedia } from "./media-storage.js";
import {
  FalCredentialMissingError,
  type FalCredentialService
} from "./fal-credentials.js";

const QUOTE_TTL_MS = 10 * 60_000;
const ACTIVE_STATES = ["queued", "submitting", "running", "downloading", "inspecting"] as const;

export type GenerationJobState =
  | "quoted"
  | "queued"
  | "submitting"
  | "running"
  | "downloading"
  | "inspecting"
  | "ready"
  | "cancelled"
  | "failed"
  | "submission_uncertain";

export interface GenerationJobView {
  id: string;
  project_id: string;
  scene_id: string;
  kind: "image";
  endpoint_id: string;
  state: GenerationJobState;
  cancel_requested: boolean;
  prompt: string;
  quote: FalImageQuote;
  quote_expires_at: string;
  failure_code?: string;
  result_media?: SceneMediaView;
}

export interface FalGenerationService {
  quoteImage(ownerId: string, projectId: string, sceneId: string, prompt: unknown): Promise<GenerationJobView>;
  confirm(ownerId: string, jobId: string, idempotencyKey: unknown): Promise<GenerationJobView>;
  get(ownerId: string, jobId: string): Promise<GenerationJobView | undefined>;
  cancel(ownerId: string, jobId: string): Promise<GenerationJobView>;
}

export class FalGenerationValidationError extends Error {}
export class FalGenerationConflictError extends Error {
  constructor(readonly type: string, message: string) {
    super(message);
  }
}
export class FalGenerationBusyError extends Error {}
export class FalGenerationNotFoundError extends Error {}

interface JobRow {
  id: string;
  ownerId: string;
  projectId: string;
  sceneId: string;
  kind: "image";
  endpointId: string;
  prompt: string;
  quoteJson: FalImageQuote;
  quoteExpiresAt: Date | string;
  state: GenerationJobState;
  cancelRequested: boolean;
  failureCode: string | null;
  resultMediaId: string | null;
  idempotencyKey: string;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== "string") throw new FalGenerationValidationError("invalid prompt");
  const prompt = value.trim();
  if (!prompt || prompt.length > 500) throw new FalGenerationValidationError("invalid prompt");
  return prompt;
}

function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") throw new FalGenerationValidationError("invalid idempotency key");
  const key = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new FalGenerationValidationError("invalid idempotency key");
  }
  return key.toLowerCase();
}

async function activeJobCount(
  client: Pool | PoolClient,
  ownerId: string,
  sceneId?: string
): Promise<number> {
  const result = sceneId
    ? await client.query(
      `SELECT COUNT(*)::int AS count FROM "GenerationJob"
        WHERE "ownerId" = $1 AND "sceneId" = $2
          AND (
            state::text = ANY($3::text[])
            OR ("cancelRequested" = TRUE AND state NOT IN ('ready', 'cancelled', 'failed', 'submission_uncertain'))
          )`,
      [ownerId, sceneId, [...ACTIVE_STATES]]
    )
    : await client.query(
      `SELECT COUNT(*)::int AS count FROM "GenerationJob"
        WHERE "ownerId" = $1
          AND (
            state::text = ANY($2::text[])
            OR ("cancelRequested" = TRUE AND state NOT IN ('ready', 'cancelled', 'failed', 'submission_uncertain'))
          )`,
      [ownerId, [...ACTIVE_STATES]]
    );
  return result.rows[0]?.count ?? 0;
}

export class PostgresFalGenerationService implements FalGenerationService {
  constructor(
    readonly pool: Pool,
    readonly credentials: FalCredentialService & {
      decryptForOwner(ownerId: string): Promise<{ id: string; apiKey: string }>;
    },
    readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async viewFromRow(row: JobRow): Promise<GenerationJobView> {
    let resultMedia: SceneMediaView | undefined;
    if (row.resultMediaId) {
      const media = await this.pool.query<StoredMedia>(
        `SELECT id, state, detected, attribution FROM "MediaAsset"
          WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3`,
        [row.resultMediaId, row.ownerId, row.projectId]
      );
      if (media.rows[0]) resultMedia = sceneMediaView(media.rows[0]);
    }
    return {
      id: row.id,
      project_id: row.projectId,
      scene_id: row.sceneId,
      kind: "image",
      endpoint_id: row.endpointId,
      state: row.state,
      cancel_requested: row.cancelRequested,
      prompt: row.prompt,
      quote: row.quoteJson,
      quote_expires_at: asDate(row.quoteExpiresAt).toISOString(),
      ...(row.failureCode ? { failure_code: row.failureCode } : {}),
      ...(resultMedia ? { result_media: resultMedia } : {})
    };
  }

  private async load(ownerId: string, jobId: string, client: Pool | PoolClient = this.pool): Promise<JobRow | undefined> {
    const result = await client.query<JobRow>(
      `SELECT id, "ownerId", "projectId", "sceneId", kind, "endpointId", prompt, "quoteJson",
              "quoteExpiresAt", state, "cancelRequested", "failureCode", "resultMediaId", "idempotencyKey"
         FROM "GenerationJob" WHERE id = $1 AND "ownerId" = $2`,
      [jobId, ownerId]
    );
    return result.rows[0];
  }

  async quoteImage(ownerId: string, projectId: string, sceneId: string, promptValue: unknown): Promise<GenerationJobView> {
    const prompt = normalizePrompt(promptValue);
    const project = await this.pool.query(
      `SELECT id FROM "Project" WHERE id = $1 AND "ownerId" = $2`,
      [projectId, ownerId]
    );
    if (!project.rowCount) throw new FalGenerationNotFoundError("project not found");
    const scene = await this.pool.query(
      `SELECT id FROM "Scene" WHERE id = $1 AND "projectId" = $2`,
      [sceneId, projectId]
    );
    if (!scene.rowCount) throw new FalGenerationNotFoundError("scene not found");
    if (await activeJobCount(this.pool, ownerId) > 0 || await activeJobCount(this.pool, ownerId, sceneId) > 0) {
      throw new FalGenerationBusyError("active FAL generation");
    }
    let credential: { id: string; apiKey: string };
    try {
      credential = await this.credentials.decryptForOwner(ownerId);
    } catch (error) {
      if (error instanceof FalCredentialMissingError) throw error;
      throw error;
    }
    let quote: FalImageQuote;
    try {
      quote = await estimateImage(credential.apiKey, this.fetchImpl);
    } catch (error) {
      if (error instanceof FalImageError) throw error;
      throw error;
    }
    const id = randomUUID();
    const inputJson = falImageInput(prompt);
    const quoteExpiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    await this.pool.query(
      `INSERT INTO "GenerationJob"
         (id, "ownerId", "projectId", "sceneId", "credentialId", kind, "endpointId", prompt,
          "inputJson", "quoteJson", "quoteExpiresAt", state, "idempotencyKey", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,'image',$6,$7,$8,$9,$10,'quoted',$11,NOW())`,
      [
        id, ownerId, projectId, sceneId, credential.id, FAL_IMAGE_ENDPOINT_ID, prompt,
        JSON.stringify(inputJson), JSON.stringify(quote), quoteExpiresAt, randomUUID()
      ]
    );
    const row = await this.load(ownerId, id);
    if (!row) throw new Error("generation job missing after insert");
    return this.viewFromRow(row);
  }

  async confirm(ownerId: string, jobId: string, idempotencyKeyValue: unknown): Promise<GenerationJobView> {
    const idempotencyKey = normalizeIdempotencyKey(idempotencyKeyValue);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<JobRow>(
        `SELECT id, "ownerId", "projectId", "sceneId", kind, "endpointId", prompt, "quoteJson",
                "quoteExpiresAt", state, "cancelRequested", "failureCode", "resultMediaId", "idempotencyKey"
           FROM "GenerationJob" WHERE id = $1 AND "ownerId" = $2 FOR UPDATE`,
        [jobId, ownerId]
      );
      const row = locked.rows[0];
      if (!row) throw new FalGenerationNotFoundError("generation job not found");
      if (row.state !== "quoted") {
        await client.query("COMMIT");
        return this.viewFromRow(row);
      }
      if (asDate(row.quoteExpiresAt).getTime() <= Date.now()) {
        throw new FalGenerationConflictError("quote_expired", "This quote expired. Request a new price.");
      }
      if (row.quoteJson.estimated_total === null) {
        throw new FalGenerationConflictError("quote_incomplete", "FAL could not calculate a total for this model.");
      }
      if (await activeJobCount(client, ownerId) > 0) {
        throw new FalGenerationBusyError("active FAL generation");
      }
      await client.query(
        `UPDATE "GenerationJob"
            SET state = 'queued', "idempotencyKey" = $1, "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3 AND state = 'quoted'`,
        [idempotencyKey, jobId, ownerId]
      );
      await client.query(
        `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
         VALUES ($1, 'generate-fal-image', $2, $3)
         ON CONFLICT ("dedupeKey") DO NOTHING`,
        [
          randomUUID(),
          `generate-fal-image:${jobId}`,
          JSON.stringify({ generationJobId: jobId, ownerId, projectId: row.projectId })
        ]
      );
      await client.query("COMMIT");
      const updated = await this.load(ownerId, jobId);
      if (!updated) throw new FalGenerationNotFoundError("generation job not found");
      return this.viewFromRow(updated);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async get(ownerId: string, jobId: string): Promise<GenerationJobView | undefined> {
    const row = await this.load(ownerId, jobId);
    return row ? this.viewFromRow(row) : undefined;
  }

  async cancel(ownerId: string, jobId: string): Promise<GenerationJobView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<JobRow>(
        `SELECT id, "ownerId", "projectId", "sceneId", kind, "endpointId", prompt, "quoteJson",
                "quoteExpiresAt", state, "cancelRequested", "failureCode", "resultMediaId", "idempotencyKey"
           FROM "GenerationJob" WHERE id = $1 AND "ownerId" = $2 FOR UPDATE`,
        [jobId, ownerId]
      );
      const row = locked.rows[0];
      if (!row) throw new FalGenerationNotFoundError("generation job not found");
      if (["ready", "cancelled", "failed", "submission_uncertain"].includes(row.state)) {
        await client.query("COMMIT");
        return this.viewFromRow(row);
      }
      const nextState = row.state === "quoted" || row.state === "queued" ? "cancelled" : row.state;
      await client.query(
        `UPDATE "GenerationJob"
            SET "cancelRequested" = TRUE, state = $1::"GenerationState", "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3`,
        [nextState, jobId, ownerId]
      );
      await client.query("COMMIT");
      const updated = await this.load(ownerId, jobId);
      if (!updated) throw new FalGenerationNotFoundError("generation job not found");
      return this.viewFromRow(updated);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function falGenerationHttpError(error: unknown): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof FalGenerationValidationError) {
    return { status: 422, body: { type: "validation", message: error.message || "invalid generation request" } };
  }
  if (error instanceof FalGenerationNotFoundError) {
    return { status: 404, body: { type: "not_found", message: "not found" } };
  }
  if (error instanceof FalGenerationBusyError) {
    return {
      status: 429,
      body: {
        type: "fal_generation_busy",
        message: "Only one active FAL generation is allowed. Wait or cancel the current job."
      }
    };
  }
  if (error instanceof FalGenerationConflictError) {
    return { status: 409, body: { type: error.type, message: error.message } };
  }
  if (error instanceof FalCredentialMissingError) {
    return { status: 409, body: { type: "fal_not_connected", message: "Connect your FAL API key in Settings first." } };
  }
  if (error instanceof FalImageError) {
    if (error.code === "credential") {
      return { status: 422, body: { type: "invalid_provider_credential", message: "FAL rejected this API key." } };
    }
    return { status: 503, body: { type: "provider_unavailable", message: "FAL could not be reached. Try again later." } };
  }
  return undefined;
}
