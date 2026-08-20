import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  FAL_IMAGE_ENDPOINT_ID,
  FAL_SPEECH_ENDPOINT_ID,
  FAL_VIDEO_DURATION,
  FAL_VIDEO_ENDPOINT_ID,
  FalImageError,
  estimateImage,
  estimateSpeech,
  estimateVideo,
  falImageInput,
  falSpeechInput,
  normalizeSpeechVoice,
  type FalImageQuote
} from "@f-engine/fal-host";
import { sceneMediaView, type SceneMediaView, type StoredMedia } from "./media-storage.js";
import {
  FalCredentialMissingError,
  type FalCredentialService
} from "./fal-credentials.js";

const QUOTE_TTL_MS = 10 * 60_000;
const ACTIVE_STATES = ["queued", "submitting", "running", "downloading", "inspecting"] as const;
const SOURCE_STILL_MAX_BYTES = 25_000_000;
const ANIMATABLE_STILL_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

export type GenerationKind = "image" | "image_to_video" | "speech";

export interface GenerationJobView {
  id: string;
  project_id: string;
  scene_id: string;
  kind: GenerationKind;
  endpoint_id: string;
  state: GenerationJobState;
  cancel_requested: boolean;
  prompt: string;
  quote: FalImageQuote;
  quote_expires_at: string;
  failure_code?: string;
  result_media?: SceneMediaView;
  source_media_id?: string;
}

export interface FalGenerationService {
  quoteImage(ownerId: string, projectId: string, sceneId: string, prompt: unknown): Promise<GenerationJobView>;
  quoteVideo(
    ownerId: string,
    projectId: string,
    sceneId: string,
    sourceMediaId: unknown,
    motionPrompt: unknown
  ): Promise<GenerationJobView>;
  quoteSpeech(ownerId: string, projectId: string, prompt: unknown, voice?: unknown): Promise<GenerationJobView>;
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

interface VideoSourceSnapshot {
  source_media_id: string;
  sealed_sha256: string;
  declared_type: string;
  width: number;
  height: number;
  bytes: number;
  duration: typeof FAL_VIDEO_DURATION;
  motion_prompt: string;
}

interface JobRow {
  id: string;
  ownerId: string;
  projectId: string;
  sceneId: string;
  kind: GenerationKind;
  endpointId: string;
  prompt: string;
  inputJson: unknown;
  quoteJson: FalImageQuote;
  quoteExpiresAt: Date | string;
  state: GenerationJobState;
  cancelRequested: boolean;
  failureCode: string | null;
  resultMediaId: string | null;
  sourceMediaId: string | null;
  providerRequestId: string | null;
  idempotencyKey: string;
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizePrompt(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") throw new FalGenerationValidationError("invalid prompt");
  const prompt = value.trim();
  if (!prompt || prompt.length > maxLength) throw new FalGenerationValidationError("invalid prompt");
  return prompt;
}

function normalizeMediaId(value: unknown): string {
  if (typeof value !== "string") throw new FalGenerationValidationError("invalid source media");
  const id = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new FalGenerationValidationError("invalid source media");
  }
  return id.toLowerCase();
}

function normalizeIdempotencyKey(value: unknown): string {
  if (typeof value !== "string") throw new FalGenerationValidationError("invalid idempotency key");
  const key = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
    throw new FalGenerationValidationError("invalid idempotency key");
  }
  return key.toLowerCase();
}

function asVideoSnapshot(value: unknown): VideoSourceSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.source_media_id !== "string" || typeof row.sealed_sha256 !== "string") return undefined;
  if (typeof row.declared_type !== "string" || typeof row.motion_prompt !== "string") return undefined;
  if (typeof row.width !== "number" || typeof row.height !== "number" || typeof row.bytes !== "number") return undefined;
  if (row.duration !== FAL_VIDEO_DURATION) return undefined;
  return {
    source_media_id: row.source_media_id,
    sealed_sha256: row.sealed_sha256,
    declared_type: row.declared_type,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    duration: FAL_VIDEO_DURATION,
    motion_prompt: row.motion_prompt
  };
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

async function assertOwnedScene(pool: Pool, ownerId: string, projectId: string, sceneId: string): Promise<void> {
  const project = await pool.query(
    `SELECT id FROM "Project" WHERE id = $1 AND "ownerId" = $2`,
    [projectId, ownerId]
  );
  if (!project.rowCount) throw new FalGenerationNotFoundError("project not found");
  const scene = await pool.query(
    `SELECT id FROM "Scene" WHERE id = $1 AND "projectId" = $2`,
    [sceneId, projectId]
  );
  if (!scene.rowCount) throw new FalGenerationNotFoundError("scene not found");
}

async function firstOwnedSceneId(pool: Pool, ownerId: string, projectId: string): Promise<string> {
  const project = await pool.query(
    `SELECT id FROM "Project" WHERE id = $1 AND "ownerId" = $2`,
    [projectId, ownerId]
  );
  if (!project.rowCount) throw new FalGenerationNotFoundError("project not found");
  const scene = await pool.query<{ id: string }>(
    `SELECT id FROM "Scene" WHERE "projectId" = $1 ORDER BY position ASC LIMIT 1`,
    [projectId]
  );
  if (!scene.rows[0]) throw new FalGenerationNotFoundError("scene not found");
  return scene.rows[0].id;
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
      kind: row.kind,
      endpoint_id: row.endpointId,
      state: row.state,
      cancel_requested: row.cancelRequested,
      prompt: row.prompt,
      quote: row.quoteJson,
      quote_expires_at: asDate(row.quoteExpiresAt).toISOString(),
      ...(row.failureCode ? { failure_code: row.failureCode } : {}),
      ...(resultMedia ? { result_media: resultMedia } : {}),
      ...(row.sourceMediaId ? { source_media_id: row.sourceMediaId } : {})
    };
  }

  private async load(ownerId: string, jobId: string, client: Pool | PoolClient = this.pool): Promise<JobRow | undefined> {
    const result = await client.query<JobRow>(
      `SELECT id, "ownerId", "projectId", "sceneId", kind, "endpointId", prompt, "inputJson", "quoteJson",
              "quoteExpiresAt", state, "cancelRequested", "failureCode", "resultMediaId", "sourceMediaId",
              "providerRequestId", "idempotencyKey"
         FROM "GenerationJob" WHERE id = $1 AND "ownerId" = $2`,
      [jobId, ownerId]
    );
    return result.rows[0];
  }

  async quoteImage(ownerId: string, projectId: string, sceneId: string, promptValue: unknown): Promise<GenerationJobView> {
    const prompt = normalizePrompt(promptValue);
    await assertOwnedScene(this.pool, ownerId, projectId, sceneId);
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

  async quoteVideo(
    ownerId: string,
    projectId: string,
    sceneId: string,
    sourceMediaIdValue: unknown,
    motionPromptValue: unknown
  ): Promise<GenerationJobView> {
    const sourceMediaId = normalizeMediaId(sourceMediaIdValue);
    const motionPrompt = normalizePrompt(motionPromptValue);
    await assertOwnedScene(this.pool, ownerId, projectId, sceneId);
    if (await activeJobCount(this.pool, ownerId) > 0 || await activeJobCount(this.pool, ownerId, sceneId) > 0) {
      throw new FalGenerationBusyError("active FAL generation");
    }
    const media = await this.pool.query<{
      id: string;
      state: string;
      declaredType: string;
      sealedSha256: string | null;
      sealedObjectKey: string | null;
      detected: { type?: string; bytes?: number; width?: number; height?: number } | null;
    }>(
      `SELECT id, state, "declaredType", "sealedSha256", "sealedObjectKey", detected
         FROM "MediaAsset"
        WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3`,
      [sourceMediaId, ownerId, projectId]
    );
    const asset = media.rows[0];
    if (!asset) throw new FalGenerationNotFoundError("source media not found");
    if (asset.state !== "ready" || !asset.sealedSha256 || !asset.sealedObjectKey) {
      throw new FalGenerationValidationError("source media is not a ready sealed still");
    }
    const type = asset.detected?.type ?? asset.declaredType;
    if (!ANIMATABLE_STILL_TYPES.has(type)) {
      throw new FalGenerationValidationError("only ready JPEG, PNG, or WebP stills can be animated");
    }
    const width = asset.detected?.width ?? 0;
    const height = asset.detected?.height ?? 0;
    const bytes = asset.detected?.bytes ?? 0;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || height < width) {
      throw new FalGenerationValidationError("source still must be portrait (height >= width)");
    }
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > SOURCE_STILL_MAX_BYTES) {
      throw new FalGenerationValidationError("source still exceeds the animation size limit");
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
      quote = await estimateVideo(credential.apiKey, this.fetchImpl);
    } catch (error) {
      if (error instanceof FalImageError) throw error;
      throw error;
    }
    const id = randomUUID();
    const inputJson: VideoSourceSnapshot = {
      source_media_id: sourceMediaId,
      sealed_sha256: asset.sealedSha256,
      declared_type: type,
      width,
      height,
      bytes,
      duration: FAL_VIDEO_DURATION,
      motion_prompt: motionPrompt
    };
    const quoteExpiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    await this.pool.query(
      `INSERT INTO "GenerationJob"
         (id, "ownerId", "projectId", "sceneId", "credentialId", kind, "endpointId", prompt, "sourceMediaId",
          "inputJson", "quoteJson", "quoteExpiresAt", state, "idempotencyKey", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,'image_to_video',$6,$7,$8,$9,$10,$11,'quoted',$12,NOW())`,
      [
        id, ownerId, projectId, sceneId, credential.id, FAL_VIDEO_ENDPOINT_ID, motionPrompt, sourceMediaId,
        JSON.stringify(inputJson), JSON.stringify(quote), quoteExpiresAt, randomUUID()
      ]
    );
    const row = await this.load(ownerId, id);
    if (!row) throw new Error("generation job missing after insert");
    return this.viewFromRow(row);
  }

  async quoteSpeech(
    ownerId: string,
    projectId: string,
    promptValue: unknown,
    voiceValue?: unknown
  ): Promise<GenerationJobView> {
    const prompt = normalizePrompt(promptValue, 2000);
    let voice: string;
    try {
      voice = normalizeSpeechVoice(voiceValue);
    } catch (error) {
      if (error instanceof FalImageError) throw new FalGenerationValidationError("invalid voice");
      throw error;
    }
    const sceneId = await firstOwnedSceneId(this.pool, ownerId, projectId);
    if (await activeJobCount(this.pool, ownerId) > 0) {
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
      quote = await estimateSpeech(credential.apiKey, prompt.length, this.fetchImpl);
    } catch (error) {
      if (error instanceof FalImageError) throw error;
      throw error;
    }
    const id = randomUUID();
    const inputJson = falSpeechInput(prompt, voice);
    const quoteExpiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    await this.pool.query(
      `INSERT INTO "GenerationJob"
         (id, "ownerId", "projectId", "sceneId", "credentialId", kind, "endpointId", prompt,
          "inputJson", "quoteJson", "quoteExpiresAt", state, "idempotencyKey", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,'speech',$6,$7,$8,$9,$10,'quoted',$11,NOW())`,
      [
        id, ownerId, projectId, sceneId, credential.id, FAL_SPEECH_ENDPOINT_ID, prompt,
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
        `SELECT id, "ownerId", "projectId", "sceneId", kind, "endpointId", prompt, "inputJson", "quoteJson",
                "quoteExpiresAt", state, "cancelRequested", "failureCode", "resultMediaId", "sourceMediaId",
                "providerRequestId", "idempotencyKey"
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
      try {
        await this.credentials.decryptForOwner(ownerId);
      } catch (error) {
        if (error instanceof FalCredentialMissingError) throw error;
        throw error;
      }
      const outboxKind = row.kind === "image_to_video" ? "generate-fal-video"
        : row.kind === "speech" ? "generate-fal-speech"
          : "generate-fal-image";
      if (row.kind === "image_to_video") {
        const snapshot = asVideoSnapshot(row.inputJson);
        if (!snapshot || !row.sourceMediaId) {
          throw new FalGenerationValidationError("invalid video generation snapshot");
        }
        const source = await client.query<{ sealedSha256: string | null; state: string }>(
          `SELECT "sealedSha256", state FROM "MediaAsset"
            WHERE id = $1 AND "ownerId" = $2 AND "projectId" = $3 FOR UPDATE`,
          [row.sourceMediaId, ownerId, row.projectId]
        );
        const asset = source.rows[0];
        if (!asset || asset.state !== "ready" || asset.sealedSha256 !== snapshot.sealed_sha256) {
          throw new FalGenerationConflictError(
            "source_changed",
            "The source image changed. Request a new price before generating."
          );
        }
      }
      await client.query(
        `UPDATE "GenerationJob"
            SET state = 'queued', "idempotencyKey" = $1, "updatedAt" = NOW()
          WHERE id = $2 AND "ownerId" = $3 AND state = 'quoted'`,
        [idempotencyKey, jobId, ownerId]
      );
      await client.query(
        `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("dedupeKey") DO NOTHING`,
        [
          randomUUID(),
          outboxKind,
          `${outboxKind}:${jobId}`,
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
        `SELECT id, "ownerId", "projectId", "sceneId", kind, "endpointId", prompt, "inputJson", "quoteJson",
                "quoteExpiresAt", state, "cancelRequested", "failureCode", "resultMediaId", "sourceMediaId",
                "providerRequestId", "idempotencyKey"
           FROM "GenerationJob" WHERE id = $1 AND "ownerId" = $2 FOR UPDATE`,
        [jobId, ownerId]
      );
      const row = locked.rows[0];
      if (!row) throw new FalGenerationNotFoundError("generation job not found");
      if (["ready", "cancelled", "failed", "submission_uncertain"].includes(row.state)) {
        await client.query("COMMIT");
        return this.viewFromRow(row);
      }
      let nextState: GenerationJobState;
      if (row.state === "quoted" || row.state === "queued") {
        nextState = "cancelled";
      } else if (!row.providerRequestId) {
        // Nothing useful for the worker to cancel at FAL — free the slot now.
        nextState = "cancelled";
      } else if (row.cancelRequested) {
        // Second cancel on a stuck cooperative cancel: force terminal so activeJobCount
        // clears. Worker still best-efforts provider cancel when it next runs.
        nextState = "cancelled";
      } else {
        nextState = row.state;
      }
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
