import { randomUUID } from "node:crypto";
import type { CommandEnvelope, ProjectSnapshot, ProjectSummary } from "@f-engine/contracts";
import type { Pool, PoolClient } from "pg";
import { applyCommand, conceptsFor } from "@f-engine/reel-engine";

export class ConflictError extends Error {
  constructor(readonly authoritativeSnapshot: ProjectSnapshot) { super("stale base revision"); }
}

export class NotFoundError extends Error {
  constructor() { super("not found"); }
}

export class ValidationError extends Error {}

export interface ProjectRepository {
  create(ownerId: string, brief: ProjectSnapshot["brief"], projectId?: string): ProjectSnapshot | Promise<ProjectSnapshot>;
  list(ownerId: string): ProjectSummary[] | Promise<ProjectSummary[]>;
  get(ownerId: string, projectId: string): ProjectSnapshot | undefined | Promise<ProjectSnapshot | undefined>;
  command(ownerId: string, command: CommandEnvelope): ProjectSnapshot | Promise<ProjectSnapshot>;
}

export class ProjectService implements ProjectRepository {
  readonly #projects = new Map<string, ProjectSnapshot>();
  readonly #receipts = new Map<string, ProjectSnapshot>();

  create(ownerId: string, brief: ProjectSnapshot["brief"], projectId = randomUUID()): ProjectSnapshot {
    const existing = this.get(ownerId, projectId);
    if (existing) return existing;
    const project: ProjectSnapshot = { schema_version: 1, id: projectId, owner_id: ownerId, revision: 0, brief, scenes: [] };
    this.#projects.set(`${ownerId}:${project.id}`, project);
    return structuredClone(project);
  }

  list(ownerId: string): ProjectSummary[] {
    const summaries: ProjectSummary[] = [];
    for (const [key, project] of this.#projects) {
      if (!key.startsWith(`${ownerId}:`)) continue;
      summaries.push({ id: project.id, revision: project.revision, brief: structuredClone(project.brief) });
    }
    return summaries.sort((left, right) => left.id.localeCompare(right.id));
  }

  get(ownerId: string, projectId: string): ProjectSnapshot | undefined {
    const value = this.#projects.get(`${ownerId}:${projectId}`);
    return value && structuredClone(value);
  }

  concepts(ownerId: string, projectId: string) {
    const project = this.get(ownerId, projectId);
    if (!project) throw new Error("not found");
    return conceptsFor(project.brief);
  }

  command(ownerId: string, command: CommandEnvelope): ProjectSnapshot {
    const project = this.get(ownerId, command.project_id);
    if (!project) throw new Error("not found");
    const receiptKey = `${ownerId}:${command.project_id}:${command.command_id}`;
    const prior = this.#receipts.get(receiptKey);
    if (prior) return structuredClone(prior);
    if (project.revision !== command.base_revision) throw new ConflictError(project);
    let updated: ProjectSnapshot;
    try {
      updated = applyCommand(project, command);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "invalid command");
    }
    this.#projects.set(`${ownerId}:${project.id}`, updated);
    this.#receipts.set(receiptKey, updated);
    return structuredClone(updated);
  }
}

type Queryable = Pick<Pool | PoolClient, "query">;

interface ProjectRow {
  id: string;
  ownerId: string;
  revision: number;
  brief: ProjectSnapshot["brief"];
}

async function projectSnapshot(
  database: Queryable,
  project: ProjectRow
): Promise<ProjectSnapshot> {
  const [selected, scenes] = await Promise.all([
    database.query<{ conceptId: string }>(
      `SELECT LOWER(title) AS "conceptId"
       FROM "Concept" WHERE "projectId" = $1 AND selected = TRUE LIMIT 1`,
      [project.id]
    ),
    database.query<{ position: number; payload: ProjectSnapshot["scenes"][number] }>(
      `SELECT position, payload FROM "Scene" WHERE "projectId" = $1 ORDER BY position`,
      [project.id]
    )
  ]);
  const snapshot: ProjectSnapshot = {
    schema_version: 1,
    id: project.id,
    owner_id: project.ownerId,
    revision: project.revision,
    brief: project.brief,
    scenes: scenes.rows.map(({ position, payload }) => ({ ...payload, order: position }))
  };
  const selectedConceptId = selected.rows[0]?.conceptId;
  if (selectedConceptId) snapshot.selected_concept_id = selectedConceptId;
  return snapshot;
}

export class PostgresProjectRepository implements ProjectRepository {
  constructor(readonly pool: Pool) {}

  async create(ownerId: string, brief: ProjectSnapshot["brief"], projectId = randomUUID()): Promise<ProjectSnapshot> {
    const client = await this.pool.connect();
    const id = projectId;
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO "Project" (id, "ownerId", revision, brief) VALUES ($1, $2, 0, $3)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id, ownerId, brief]
      );
      if (!inserted.rowCount) {
        const existing = await client.query<ProjectRow>(
          `SELECT id, "ownerId", revision, brief FROM "Project" WHERE "ownerId" = $1 AND id = $2`,
          [ownerId, id]
        );
        const row = existing.rows[0];
        if (!row) throw new Error("project id collision");
        const snapshot = await projectSnapshot(client, row);
        await client.query("COMMIT");
        return snapshot;
      }
      const concepts = conceptsFor(brief);
      for (const [position, concept] of concepts.entries()) {
        await client.query(
          `INSERT INTO "Concept" (id, "projectId", position, title, treatment, selected)
           VALUES ($1, $2, $3, $4, $5, FALSE)`,
          [randomUUID(), id, position, concept.title, concept.treatment]
        );
      }
      await client.query("COMMIT");
      return { schema_version: 1, id, owner_id: ownerId, revision: 0, brief, scenes: [] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(ownerId: string): Promise<ProjectSummary[]> {
    const result = await this.pool.query<Pick<ProjectRow, "id" | "revision" | "brief">>(
      `SELECT id, revision, brief FROM "Project" WHERE "ownerId" = $1 ORDER BY id`,
      [ownerId]
    );
    return result.rows.map(({ id, revision, brief }) => ({ id, revision, brief }));
  }

  async get(ownerId: string, projectId: string): Promise<ProjectSnapshot | undefined> {
    const result = await this.pool.query<ProjectRow>(
      `SELECT id, "ownerId", revision, brief
       FROM "Project" WHERE "ownerId" = $1 AND id = $2`,
      [ownerId, projectId]
    );
    const project = result.rows[0];
    return project && projectSnapshot(this.pool, project);
  }

  async command(ownerId: string, command: CommandEnvelope): Promise<ProjectSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const projects = await client.query<ProjectRow>(
        `SELECT id, "ownerId", revision, brief
         FROM "Project" WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
        [ownerId, command.project_id]
      );
      const project = projects.rows[0];
      if (!project) throw new NotFoundError();

      const receipt = await client.query<{ result: ProjectSnapshot }>(
        `SELECT result FROM "CommandReceipt"
         WHERE "ownerId" = $1 AND "projectId" = $2 AND "commandId" = $3`,
        [ownerId, command.project_id, command.command_id]
      );
      const prior = receipt.rows[0]?.result;
      if (prior) {
        await client.query("COMMIT");
        return prior;
      }

      const authoritative = await projectSnapshot(client, project);
      if (authoritative.revision !== command.base_revision) throw new ConflictError(authoritative);
      let updated: ProjectSnapshot;
      try {
        updated = applyCommand(authoritative, command);
      } catch (error) {
        throw new ValidationError(error instanceof Error ? error.message : "invalid command");
      }
      await this.persistCommand(client, command, updated);
      const revision = await client.query<{ revision: number }>(
        `UPDATE "Project" SET revision = revision + 1
         WHERE "ownerId" = $1 AND id = $2 RETURNING revision`,
        [ownerId, command.project_id]
      );
      if (revision.rows[0]?.revision !== updated.revision) throw new Error("revision update failed");
      await client.query(
        `INSERT INTO "CommandReceipt"
           (id, "ownerId", "projectId", "commandId", "baseRevision", result)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), ownerId, command.project_id, command.command_id, command.base_revision, updated]
      );
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async persistCommand(
    client: PoolClient,
    command: CommandEnvelope,
    updated: ProjectSnapshot
  ): Promise<void> {
    if (command.kind === "select_concept") {
      await client.query(`UPDATE "Concept" SET selected = FALSE WHERE "projectId" = $1 AND selected = TRUE`, [command.project_id]);
      await client.query(
        `UPDATE "Concept" SET selected = TRUE
         WHERE "projectId" = $1 AND LOWER(title) = $2`,
        [command.project_id, updated.selected_concept_id]
      );
      for (const scene of updated.scenes) {
        await client.query(
          `INSERT INTO "Scene" (id, "projectId", position, payload)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, payload = EXCLUDED.payload`,
          [scene.id, command.project_id, scene.order, scene]
        );
      }
      return;
    }
    if (command.kind === "update_scene") {
      const sceneId = (command.payload.scene as { id?: unknown } | undefined)?.id;
      const scene = updated.scenes.find(({ id }) => id === sceneId);
      if (!scene) throw new Error("updated scene missing");
      await client.query(
        `UPDATE "Scene" SET payload = $1 WHERE "projectId" = $2 AND id = $3`,
        [scene, command.project_id, scene.id]
      );
      return;
    }
    if (command.kind === "replace_storyboard") {
      await this.replaceScenes(client, command.project_id, updated.scenes);
      return;
    }
    if (command.kind === "add_scene" || command.kind === "remove_scene") {
      await this.syncScenes(client, command.project_id, updated.scenes);
      return;
    }
    if (command.kind === "update_soundtrack") {
      await client.query(`UPDATE "Project" SET brief = $1 WHERE id = $2`, [updated.brief, command.project_id]);
      return;
    }
    if (command.kind !== "reorder_scene") throw new Error("unsupported command persistence");
    await client.query(`UPDATE "Scene" SET position = -position - 1 WHERE "projectId" = $1`, [command.project_id]);
    for (const scene of updated.scenes) {
      await client.query(
        `UPDATE "Scene" SET position = $1, payload = $2 WHERE "projectId" = $3 AND id = $4`,
        [scene.order, scene, command.project_id, scene.id]
      );
    }
  }

  private async replaceScenes(
    client: PoolClient,
    projectId: string,
    scenes: ProjectSnapshot["scenes"]
  ): Promise<void> {
    await client.query(`DELETE FROM "Scene" WHERE "projectId" = $1`, [projectId]);
    for (const scene of scenes) {
      await client.query(
        `INSERT INTO "Scene" (id, "projectId", position, payload) VALUES ($1, $2, $3, $4)`,
        [scene.id, projectId, scene.order, scene]
      );
    }
  }

  private async syncScenes(
    client: PoolClient,
    projectId: string,
    scenes: ProjectSnapshot["scenes"]
  ): Promise<void> {
    await client.query(`UPDATE "Scene" SET position = -position - 1 WHERE "projectId" = $1`, [projectId]);
    await client.query(
      `DELETE FROM "Scene" WHERE "projectId" = $1 AND NOT (id = ANY($2::text[]))`,
      [projectId, scenes.map(({ id }) => id)]
    );
    for (const scene of scenes) {
      const result = await client.query(
        `INSERT INTO "Scene" (id, "projectId", position, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET position = EXCLUDED.position, payload = EXCLUDED.payload
         WHERE "Scene"."projectId" = EXCLUDED."projectId"
         RETURNING id`,
        [scene.id, projectId, scene.order, scene]
      );
      if (result.rowCount !== 1) throw new Error("scene id belongs to another project");
    }
  }
}

export interface UploadAdmission {
  id: string;
  ownerId: string;
  projectId: string;
  objectKey: string;
  state: "admitted" | "inspecting" | "ready" | "quarantined";
  declaredType: string;
  maxBytes: number;
}

export class MediaService {
  readonly #assets = new Map<string, UploadAdmission>();
  admit(ownerId: string, projectId: string, declaredType: string, bytes: number): UploadAdmission & { method: "PUT"; expiresInSeconds: 300 } {
    const allowed = new Set(["video/mp4", "image/jpeg", "image/png", "image/webp", "audio/mpeg", "audio/wav", "audio/mp4"]);
    if (!allowed.has(declaredType) || bytes <= 0 || bytes > 100_000_000) throw new Error("upload declaration rejected");
    const id = randomUUID();
    const asset: UploadAdmission = { id, ownerId, projectId, objectKey: `projects/${projectId}/media/${id}`, state: "admitted", declaredType, maxBytes: bytes };
    this.#assets.set(`${ownerId}:${projectId}:${id}`, asset);
    return { ...asset, method: "PUT", expiresInSeconds: 300 };
  }
  complete(ownerId: string, projectId: string, id: string): UploadAdmission {
    const asset = this.#assets.get(`${ownerId}:${projectId}:${id}`);
    if (!asset) throw new Error("not found");
    if (asset.state === "admitted") asset.state = "inspecting";
    return { ...asset };
  }
  inspected(ownerId: string, projectId: string, id: string, detected: { type: string; bytes: number }): UploadAdmission {
    const asset = this.#assets.get(`${ownerId}:${projectId}:${id}`);
    if (!asset) throw new Error("not found");
    asset.state = detected.type === asset.declaredType && detected.bytes <= asset.maxBytes ? "ready" : "quarantined";
    return { ...asset };
  }
}

export interface PexelsRecord { sourceUrl: string; creator: string; attributionUrl: string; sourceLabel: "Pexels"; objectKey: string }
export function copyPexelsResult(projectId: string, input: Omit<PexelsRecord, "sourceLabel" | "objectKey">): PexelsRecord {
  return { ...input, sourceLabel: "Pexels", objectKey: `projects/${projectId}/media/${randomUUID()}` };
}

export class RenderService {
  readonly #cancelled = new Set<string>();
  readonly #events = new Map<string, Array<{ eventId: string; phase: string }>>();
  create(ownerId: string, projectId: string, revision: number) {
    const jobId = randomUUID();
    this.#events.set(jobId, [{ eventId: "1", phase: "queued" }]);
    return { jobId, ownerId, projectId, revision, objectKey: `projects/${projectId}/renders/${revision}.mp4`, requestId: randomUUID() };
  }
  cancel(ownerId: string, job: { jobId: string; ownerId: string }) {
    if (job.ownerId !== ownerId) throw new Error("not found");
    this.#cancelled.add(job.jobId);
    return { jobId: job.jobId, state: "cancelled" as const };
  }
  events(ownerId: string, job: { jobId: string; ownerId: string }, lastEventId?: string) {
    if (job.ownerId !== ownerId) throw new Error("not found");
    const events = this.#events.get(job.jobId) ?? [];
    return lastEventId ? events.filter(({ eventId }) => Number(eventId) > Number(lastEventId)) : events;
  }
  signedDownload(ownerId: string, job: { ownerId: string; objectKey: string }, now = Date.now()) {
    if (job.ownerId !== ownerId) throw new Error("not found");
    return { url: `https://download.invalid/${job.objectKey}?expires=${now + 300_000}`, expiresAt: now + 300_000 };
  }
}
