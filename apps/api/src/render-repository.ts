import { randomUUID } from "node:crypto";
import { isProjectSnapshot, type ProjectSnapshot } from "@f-engine/contracts";
import { validateRenderProfile, type RenderProfile } from "@f-engine/reel-engine";
import type { Pool, PoolClient } from "pg";

export type RenderKind = "preview" | "final";
export interface RenderProfiles { preview: RenderProfile; final: RenderProfile }

export function renderProfilesFromEnv(env: Record<string, string | undefined>): RenderProfiles {
  const profile = (prefix: "PREVIEW_RENDER" | "RENDER", defaults: [number, number]): RenderProfile => {
    const watermark = env[`${prefix}_WATERMARK`]?.trim();
    return validateRenderProfile({
      width: Number(env[`${prefix}_WIDTH`] ?? defaults[0]),
      height: Number(env[`${prefix}_HEIGHT`] ?? defaults[1]),
      ...(watermark ? { watermark } : {})
    });
  };
  return { preview: profile("PREVIEW_RENDER", [540, 960]), final: profile("RENDER", [720, 1280]) };
}

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
  kind: RenderKind;
  renderProfile: RenderProfile;
  state: "queued" | "running" | "cancelled" | "complete" | "failed";
}

export interface RenderResultRecord {
  jobId: string;
  objectKey: string;
  metadata: Record<string, unknown>;
  kind: RenderKind;
  stale: boolean;
}

export class RenderCapacityError extends Error {
  constructor() {
    super("render capacity reached");
  }
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
  constructor(
    readonly pool: Pool,
    readonly profiles: RenderProfiles = renderProfilesFromEnv({})
  ) {}

  async create(ownerId: string, projectId: string, kind: RenderKind): Promise<RenderJobRecord | undefined> {
    const client = await this.pool.connect();
    let attemptedRevision: number | undefined;
    try {
      await client.query("BEGIN");
      const owner = await client.query(
        `SELECT id FROM "User" WHERE id = $1 FOR UPDATE`,
        [ownerId]
      );
      if (!owner.rowCount) {
        await client.query("ROLLBACK");
        return undefined;
      }
      const project = await client.query<{
        id: string;
        ownerId: string;
        revision: number;
        brief: ProjectSnapshot["brief"];
      }>(
        `SELECT id, "ownerId", revision, brief
           FROM "Project" WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [ownerId, projectId]
      );
      const projectRow = project.rows[0];
      if (!projectRow) {
        await client.query("ROLLBACK");
        return undefined;
      }
      attemptedRevision = projectRow.revision;
      const existing = await client.query<{
        id: string;
        ownerId: string;
        projectId: string;
        revision: number;
        kind: RenderKind;
        renderProfile: RenderProfile;
        state: RenderJobRecord["state"];
      }>(
        `SELECT id, "ownerId", "projectId", revision, kind, "renderProfile"
           FROM "RenderJob"
          WHERE "ownerId" = $1 AND "projectId" = $2 AND revision = $3
            AND kind = $4
            AND state IN ('queued', 'running', 'complete')
          LIMIT 1`,
        [ownerId, projectId, projectRow.revision, kind]
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        await client.query("COMMIT");
        return {
          jobId: existingRow.id,
          ownerId: existingRow.ownerId,
          projectId: existingRow.projectId,
          revision: existingRow.revision,
          kind: existingRow.kind,
          renderProfile: existingRow.renderProfile,
          state: existingRow.state
        };
      }
      const active = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM "RenderJob"
          WHERE "ownerId" = $1 AND state IN ('queued', 'running')`,
        [ownerId]
      );
      if (Number(active.rows[0]?.count ?? 0) >= 3) {
        throw new RenderCapacityError();
      }
      const selected = await client.query<{ conceptId: string }>(
        `SELECT LOWER(title) AS "conceptId"
           FROM "Concept" WHERE "projectId" = $1 AND selected = TRUE
          ORDER BY position LIMIT 1`,
        [projectId]
      );
      const scenes = await client.query<{
        position: number;
        payload: ProjectSnapshot["scenes"][number];
      }>(
        `SELECT position, payload FROM "Scene" WHERE "projectId" = $1 ORDER BY position`,
        [projectId]
      );
      const renderInput: ProjectSnapshot = {
        schema_version: 1,
        id: projectRow.id,
        owner_id: projectRow.ownerId,
        revision: projectRow.revision,
        brief: projectRow.brief,
        scenes: scenes.rows.map(({ position, payload }) => ({ ...payload, order: position }))
      };
      const selectedConceptId = selected.rows[0]?.conceptId;
      if (selectedConceptId) renderInput.selected_concept_id = selectedConceptId;
      if (!isProjectSnapshot(renderInput)) throw new Error("invalid project snapshot");
      const jobId = randomUUID();
      const job: RenderJobRecord = {
        jobId,
        ownerId,
        projectId,
        revision: renderInput.revision,
        kind,
        renderProfile: structuredClone(this.profiles[kind]),
        state: "queued"
      };
      await client.query(
        `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, kind, "renderProfile", "renderInput", state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')`,
        [jobId, ownerId, projectId, job.revision, job.kind, job.renderProfile, renderInput]
      );
      await client.query(
        `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
         VALUES ($1, 'render-preview', $2, $3)`,
        [randomUUID(), `render-preview:${projectId}:${job.revision}:${kind}:${jobId}`, {
          jobId,
          ownerId,
          projectId,
          revision: job.revision,
          kind
        }]
      );
      await insertEvent(client, jobId, "queued", 0);
      await client.query("COMMIT");
      return job;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string; constraint?: string }).code === "23505"
        && (error as { constraint?: string }).constraint === "RenderJob_canonical_revision_kind_key"
        && attemptedRevision !== undefined) {
        const canonical = await client.query<{
          id: string;
          ownerId: string;
          projectId: string;
          revision: number;
          kind: RenderKind;
          renderProfile: RenderProfile;
          state: RenderJobRecord["state"];
        }>(
          `SELECT id, "ownerId", "projectId", revision, kind, "renderProfile", state
             FROM "RenderJob"
            WHERE "ownerId" = $1 AND "projectId" = $2 AND revision = $3
              AND kind = $4
              AND state IN ('queued', 'running', 'complete')
            LIMIT 1`,
          [ownerId, projectId, attemptedRevision, kind]
        );
        const row = canonical.rows[0];
        if (row) {
          return {
            jobId: row.id,
            ownerId: row.ownerId,
            projectId: row.projectId,
            revision: row.revision,
            kind: row.kind,
            renderProfile: row.renderProfile,
            state: row.state
          };
        }
      }
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
        id: string; ownerId: string; projectId: string; revision: number;
        kind: RenderKind; renderProfile: RenderProfile; state: RenderJobRecord["state"];
      }>(
        `UPDATE "RenderJob" SET state = 'cancelled'
          WHERE "ownerId" = $1 AND id = $2 AND state IN ('queued', 'running')
          RETURNING id, "ownerId", "projectId", revision, kind, "renderProfile", state`,
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
        kind: row.kind,
        renderProfile: row.renderProfile,
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
      `SELECT r."jobId", r."objectKey", r.metadata, j.kind, (j.revision <> p.revision) AS stale
         FROM "RenderResult" r
         JOIN "RenderJob" j ON j.id = r."jobId"
         JOIN "Project" p ON p.id = j."projectId"
        WHERE j."ownerId" = $1 AND j.id = $2 AND j.state = 'complete'`,
      [ownerId, jobId]
    );
    return result.rows[0];
  }
}
