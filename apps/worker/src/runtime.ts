import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { ProjectSnapshot, Scene } from "@f-motion/contracts";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { inspectMedia, renderObjectKey, renderPreview } from "./index.js";
import type { InspectionJob, PreviewJob, QueueHandlers } from "./queue.js";

interface WorkerObjectStore {
  inspect(objectKey: string): Promise<{ type: string; bytes: number }>;
  put(objectKey: string, body: Uint8Array, contentType: string): Promise<void>;
}

export class S3WorkerObjectStore implements WorkerObjectStore {
  constructor(readonly client: S3Client, readonly bucket: string) {}

  async inspect(objectKey: string) {
    const result = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: objectKey
    }));
    return { type: result.ContentType ?? "application/octet-stream", bytes: Number(result.ContentLength ?? 0) };
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

export function createQueueHandlers(pool: pg.Pool, store: WorkerObjectStore): QueueHandlers {
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
      const detected = await store.inspect(asset.objectKey);
      const accepted = inspectMedia(asset.declaredType, detected.type, detected.bytes, asset.maxBytes).accepted;
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
      const directory = await mkdtemp(join(tmpdir(), `fmotion-${job.jobId}-`));
      const output = join(directory, "preview.mp4");
      try {
        if (!await event(pool, job.jobId, "rendering", 35)) return { state: "cancelled" };
        await renderPreview(output, snapshot, signal);
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
              width: 720,
              height: 1280,
              watermark: "F-Motion preview",
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
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  };
}
