import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export interface RenderEvent {
  eventId: string;
  phase: "queued" | "preparing" | "rendering" | "uploading" | "complete" | "cancelled" | "failed";
  percent: number;
}

export interface RenderJobRecord {
  jobId: string;
  ownerId: string;
  projectId: string;
  revision: number;
  state: "queued" | "running" | "cancelled" | "complete" | "failed";
}

export interface RenderResultRecord {
  jobId: string;
  objectKey: string;
  metadata: Record<string, unknown>;
  stale: boolean;
}

async function insertEvent(
  client: PoolClient,
  jobId: string,
  phase: RenderEvent["phase"],
  percent: number
): Promise<void> {
  await client.query(
    `INSERT INTO "RenderEvent" ("jobId", phase, percent) VALUES ($1, $2, $3)`,
    [jobId, phase, percent]
  );
}

export class PostgresRenderRepository {
  constructor(readonly pool: Pool) {}

  async create(ownerId: string, projectId: string): Promise<RenderJobRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const project = await client.query<{ revision: number }>(
        `SELECT revision FROM "Project" WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [ownerId, projectId]
      );
      if (!project.rows[0]) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const jobId = randomUUID();
      const job: RenderJobRecord = {
        jobId,
        ownerId,
        projectId,
        revision: project.rows[0].revision,
        state: "queued"
      };
      await client.query(
        `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, state)
         VALUES ($1, $2, $3, $4, 'queued')`,
        [jobId, ownerId, projectId, job.revision]
      );
      await client.query(
        `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
         VALUES ($1, 'render-preview', $2, $3)`,
        [randomUUID(), `render-preview:${projectId}:${job.revision}:${jobId}`, {
          jobId,
          ownerId,
          projectId,
          revision: job.revision
        }]
      );
      await insertEvent(client, jobId, "queued", 0);
      await client.query("COMMIT");
      return job;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(ownerId: string, jobId: string): Promise<RenderJobRecord | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string; ownerId: string; projectId: string; revision: number; state: RenderJobRecord["state"];
      }>(
        `UPDATE "RenderJob" SET state = 'cancelled'
          WHERE "ownerId" = $1 AND id = $2 AND state IN ('queued', 'running')
          RETURNING id, "ownerId", "projectId", revision, state`,
        [ownerId, jobId]
      );
      const row = result.rows[0];
      if (row) await insertEvent(client, jobId, "cancelled", 0);
      await client.query("COMMIT");
      return row && {
        jobId: row.id,
        ownerId: row.ownerId,
        projectId: row.projectId,
        revision: row.revision,
        state: row.state
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async events(ownerId: string, jobId: string, lastEventId?: string): Promise<RenderEvent[] | undefined> {
    const owned = await this.pool.query(
      `SELECT 1 FROM "RenderJob" WHERE "ownerId" = $1 AND id = $2`,
      [ownerId, jobId]
    );
    if (!owned.rowCount) return undefined;
    const after = /^\d+$/.test(lastEventId ?? "") ? Number(lastEventId) : 0;
    const events = await this.pool.query<{ eventId: string; phase: RenderEvent["phase"]; percent: number }>(
      `SELECT id::text AS "eventId", phase, percent
         FROM "RenderEvent" WHERE "jobId" = $1 AND id > $2 ORDER BY id`,
      [jobId, after]
    );
    return events.rows;
  }

  async progress(jobId: string, phase: RenderEvent["phase"], percent: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query(
        `UPDATE "RenderJob" SET state = 'running'
          WHERE id = $1 AND state IN ('queued', 'running') RETURNING id`,
        [jobId]
      );
      if (job.rowCount) await insertEvent(client, jobId, phase, percent);
      await client.query("COMMIT");
      return job.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(jobId: string, objectKey: string, metadata: Record<string, unknown>): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query(
        `SELECT 1 FROM "RenderJob" WHERE id = $1 AND state IN ('queued', 'running') FOR UPDATE`,
        [jobId]
      );
      if (!job.rowCount) {
        await client.query("ROLLBACK");
        return false;
      }
      const result = await client.query(
        `INSERT INTO "RenderResult" (id, "jobId", "objectKey", metadata)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("jobId") DO NOTHING`,
        [randomUUID(), jobId, objectKey, metadata]
      );
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return true;
      }
      await client.query(`UPDATE "RenderJob" SET state = 'complete' WHERE id = $1`, [jobId]);
      await insertEvent(client, jobId, "complete", 100);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async result(ownerId: string, jobId: string): Promise<RenderResultRecord | undefined> {
    const result = await this.pool.query<RenderResultRecord>(
      `SELECT r."jobId", r."objectKey", r.metadata, (j.revision <> p.revision) AS stale
         FROM "RenderResult" r
         JOIN "RenderJob" j ON j.id = r."jobId"
         JOIN "Project" p ON p.id = j."projectId"
        WHERE j."ownerId" = $1 AND j.id = $2 AND j.state = 'complete'`,
      [ownerId, jobId]
    );
    return result.rows[0];
  }
}
