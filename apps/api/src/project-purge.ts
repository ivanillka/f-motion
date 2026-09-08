import type { Pool, PoolClient } from "pg";

const activeRenderStates = ["queued", "running"] as const;
const activeGenerationStates = [
  "queued",
  "submitting",
  "running",
  "downloading",
  "inspecting"
] as const;

export class ProjectBusyError extends Error {
  constructor() {
    super("project has an active render or generation job");
  }
}

export type ObjectStoreDelete = {
  delete(objectKey: string): Promise<void>;
};

export type ProjectPurgeResult = {
  project_id: string;
  deleted: true;
  storage_failures: string[];
};

function uniqueKeys(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function collectProjectObjectKeys(
  database: Pick<Pool | PoolClient, "query">,
  ownerId: string,
  projectId: string
): Promise<string[]> {
  const [media, renders] = await Promise.all([
    database.query<{ quarantineObjectKey: string; sealedObjectKey: string | null }>(
      `SELECT "quarantineObjectKey", "sealedObjectKey"
         FROM "MediaAsset"
        WHERE "ownerId" = $1 AND "projectId" = $2`,
      [ownerId, projectId]
    ),
    database.query<{ objectKey: string }>(
      `SELECT r."objectKey"
         FROM "RenderResult" r
         JOIN "RenderJob" j ON j.id = r."jobId"
        WHERE j."ownerId" = $1 AND j."projectId" = $2`,
      [ownerId, projectId]
    )
  ]);
  return uniqueKeys([
    ...media.rows.flatMap((row) => [row.quarantineObjectKey, row.sealedObjectKey]),
    ...renders.rows.map((row) => row.objectKey)
  ]);
}

export async function projectHasActiveJobs(
  database: Pick<Pool | PoolClient, "query">,
  ownerId: string,
  projectId: string
): Promise<boolean> {
  const [renders, generations] = await Promise.all([
    database.query<{ one: number }>(
      `SELECT 1 AS one FROM "RenderJob"
        WHERE "ownerId" = $1 AND "projectId" = $2
          AND state::text = ANY($3::text[])
        LIMIT 1`,
      [ownerId, projectId, [...activeRenderStates]]
    ),
    database.query<{ one: number }>(
      `SELECT 1 AS one FROM "GenerationJob"
        WHERE "ownerId" = $1 AND "projectId" = $2
          AND state::text = ANY($3::text[])
        LIMIT 1`,
      [ownerId, projectId, [...activeGenerationStates]]
    )
  ]);
  return Boolean(renders.rows[0] || generations.rows[0]);
}

export async function purgeProject(
  pool: Pool,
  store: ObjectStoreDelete,
  ownerId: string,
  projectId: string
): Promise<ProjectPurgeResult | undefined> {
  const client = await pool.connect();
  let objectKeys: string[] = [];
  try {
    await client.query("BEGIN");
    const project = await client.query<{ id: string }>(
      `SELECT id FROM "Project" WHERE "ownerId" = $1 AND id = $2 FOR UPDATE`,
      [ownerId, projectId]
    );
    if (!project.rows[0]) {
      await client.query("ROLLBACK");
      return undefined;
    }
    if (await projectHasActiveJobs(client, ownerId, projectId)) {
      throw new ProjectBusyError();
    }
    objectKeys = await collectProjectObjectKeys(client, ownerId, projectId);
    await client.query(
      `DELETE FROM "WorkOutbox" WHERE payload->>'projectId' = $1`,
      [projectId]
    );
    const deleted = await client.query(
      `DELETE FROM "Project" WHERE "ownerId" = $1 AND id = $2`,
      [ownerId, projectId]
    );
    if ((deleted.rowCount ?? 0) !== 1) throw new Error("project delete failed");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const storage_failures: string[] = [];
  for (const objectKey of objectKeys) {
    try {
      await store.delete(objectKey);
    } catch (error) {
      storage_failures.push(objectKey);
      console.error("project purge storage delete failed", { projectId, objectKey, error });
    }
  }
  return { project_id: projectId, deleted: true, storage_failures };
}
