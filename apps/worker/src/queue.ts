import pg from "pg";
import { PgBoss, type Job } from "pg-boss";

export const inspectionQueue = "inspect-media";
export const renderQueue = "render-preview";
export const falImageQueue = "generate-fal-image";

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
  kind: "preview" | "final";
}

export interface FalImageQueueJob {
  generationJobId: string;
  ownerId: string;
  projectId: string;
}

export interface QueueHandlers {
  inspect(job: InspectionJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  render(job: PreviewJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  generateFalImage?(job: FalImageQueueJob, signal: AbortSignal): Promise<Record<string, unknown>>;
}

interface OutboxRow {
  id: string;
  kind: string;
  dedupeKey: string;
  payload: object;
}

const defaultOutboxRetentionHours = 7 * 24;
const outboxCleanupIntervalMs = 60 * 60 * 1000;

export function outboxRetentionHoursFromEnv(
  env: Record<string, string | undefined>
): number {
  const configured = env.OUTBOX_RETENTION_HOURS;
  if (configured === undefined) return defaultOutboxRetentionHours;
  const raw = configured.trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error("invalid OUTBOX_RETENTION_HOURS");
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("invalid OUTBOX_RETENTION_HOURS");
  return hours;
}

export async function dispatchOutbox(pool: pg.Pool, boss: PgBoss): Promise<number> {
  const rows = await pool.query<OutboxRow>(
    `SELECT id, kind, "dedupeKey", payload
       FROM "WorkOutbox" WHERE "dispatchedAt" IS NULL
      ORDER BY "createdAt" LIMIT 25`
  );
  let dispatched = 0;
  for (const row of rows.rows) {
    await boss.send(row.kind, row.payload, {
      id: row.id,
      singletonKey: row.dedupeKey,
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      expireInSeconds: row.kind === renderQueue ? 300 : row.kind === falImageQueue ? 600 : 60
    });
    // A null id means pg-boss already has this immutable outbox UUID. The send
    // still succeeded, so a retry after a mark failure can close the crash window.
    const updated = await pool.query(
      `UPDATE "WorkOutbox" SET "dispatchedAt" = NOW()
        WHERE id = $1 AND "dispatchedAt" IS NULL`,
      [row.id]
    );
    dispatched += updated.rowCount ?? 0;
  }
  return dispatched;
}

export async function cleanupDispatchedOutbox(
  pool: pg.Pool,
  retentionHours: number
): Promise<number> {
  const deleted = await pool.query(
    `WITH expired AS (
       SELECT id FROM "WorkOutbox"
        WHERE "dispatchedAt" IS NOT NULL
          AND "dispatchedAt" < NOW() - ($1::double precision * INTERVAL '1 hour')
        ORDER BY "dispatchedAt", id
        FOR UPDATE SKIP LOCKED
        LIMIT 250
     )
     DELETE FROM "WorkOutbox" AS outbox
      USING expired
      WHERE outbox.id = expired.id`,
    [retentionHours]
  );
  return deleted.rowCount ?? 0;
}

export async function startQueueRuntime(
  connectionString: string,
  handlers: QueueHandlers,
  pool = new pg.Pool({ connectionString }),
  outboxRetentionHours = defaultOutboxRetentionHours
) {
  const boss = await new PgBoss({
    connectionString,
    maintenanceIntervalSeconds: 1,
    monitorIntervalSeconds: 10
  }).start();
  await boss.createQueue(inspectionQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 60 });
  await boss.createQueue(renderQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 300 });
  await boss.createQueue(falImageQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 600 });
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
  if (handlers.generateFalImage) {
    await boss.work<FalImageQueueJob>(falImageQueue, { pollingIntervalSeconds: 1 }, async (jobs: Job<FalImageQueueJob>[]) => {
      const job = jobs[0];
      if (!job) return;
      return handlers.generateFalImage!(job.data, job.signal);
    });
  }
  await dispatchOutbox(pool, boss);
  await cleanupDispatchedOutbox(pool, outboxRetentionHours);
  const dispatchTimer = setInterval(
    () => void dispatchOutbox(pool, boss).catch((error) => boss.emit("error", error)),
    1000
  );
  // ponytail: one 250-row batch per hour caps cleanup work but may lag a large
  // backlog. Upgrade after measuring cleanup count and oldest-undispatched age.
  const cleanupTimer = setInterval(
    () => void cleanupDispatchedOutbox(pool, outboxRetentionHours)
      .catch((error) => boss.emit("error", error)),
    outboxCleanupIntervalMs
  );
  dispatchTimer.unref();
  cleanupTimer.unref();
  return {
    boss,
    pool,
    stop: async () => {
      clearInterval(dispatchTimer);
      clearInterval(cleanupTimer);
      await boss.stop();
      await pool.end();
    }
  };
}
