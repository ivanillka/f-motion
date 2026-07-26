import pg from "pg";
import { PgBoss, type Job } from "pg-boss";

export const inspectionQueue = "inspect-media";
export const renderQueue = "render-preview";

export interface InspectionJob {
  assetId: string;
  ownerId: string;
  projectId: string;
}

export interface PreviewJob {
  jobId: string;
  ownerId: string;
  projectId: string;
  revision: number;
}

export interface QueueHandlers {
  inspect(job: InspectionJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  render(job: PreviewJob, signal: AbortSignal): Promise<Record<string, unknown>>;
}

interface OutboxRow {
  id: string;
  kind: string;
  dedupeKey: string;
  payload: object;
}

export async function dispatchOutbox(pool: pg.Pool, boss: PgBoss): Promise<number> {
  const rows = await pool.query<OutboxRow>(
    `SELECT id, kind, "dedupeKey", payload
       FROM "WorkOutbox" WHERE "dispatchedAt" IS NULL
      ORDER BY "createdAt" LIMIT 25`
  );
  let dispatched = 0;
  for (const row of rows.rows) {
    const jobId = await boss.send(row.kind, row.payload, {
      singletonKey: row.dedupeKey,
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      expireInSeconds: row.kind === renderQueue ? 300 : 60
    });
    if (!jobId) continue;
    const updated = await pool.query(
      `UPDATE "WorkOutbox" SET "dispatchedAt" = NOW()
        WHERE id = $1 AND "dispatchedAt" IS NULL`,
      [row.id]
    );
    dispatched += updated.rowCount ?? 0;
  }
  return dispatched;
}

export async function startQueueRuntime(connectionString: string, handlers: QueueHandlers) {
  const pool = new pg.Pool({ connectionString });
  const boss = await new PgBoss({
    connectionString,
    maintenanceIntervalSeconds: 1,
    monitorIntervalSeconds: 10
  }).start();
  await boss.createQueue(inspectionQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 60 });
  await boss.createQueue(renderQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 300 });
  await boss.work<InspectionJob>(inspectionQueue, { pollingIntervalSeconds: 1 }, async (jobs: Job<InspectionJob>[]) => {
    const job = jobs[0];
    if (!job) return;
    return handlers.inspect(job.data, job.signal);
  });
  await boss.work<PreviewJob>(renderQueue, { pollingIntervalSeconds: 1 }, async (jobs: Job<PreviewJob>[]) => {
    const job = jobs[0];
    if (!job) return;
    return handlers.render(job.data, job.signal);
  });
  await dispatchOutbox(pool, boss);
  const timer = setInterval(() => void dispatchOutbox(pool, boss).catch((error) => boss.emit("error", error)), 1000);
  timer.unref();
  return {
    boss,
    pool,
    stop: async () => {
      clearInterval(timer);
      await boss.stop();
      await pool.end();
    }
  };
}
