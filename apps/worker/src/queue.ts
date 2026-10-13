import { renderNotifyQueue, type RenderNotifyJob } from "@f-engine/contracts/host-notify";
import pg from "pg";
import { PgBoss, type Job } from "pg-boss";

export const inspectionQueue = "inspect-media";
export const renderQueue = "render-preview";
export const falImageQueue = "generate-fal-image";
export const falVideoQueue = "generate-fal-video";
export const falSpeechQueue = "generate-fal-speech";
export { renderNotifyQueue };

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

export type FalVideoQueueJob = FalImageQueueJob;
export type FalSpeechQueueJob = FalImageQueueJob;

export interface QueueHandlers {
  inspect(job: InspectionJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  render(job: PreviewJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  notifyRender?(job: RenderNotifyJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  generateFalImage?(job: FalImageQueueJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  generateFalVideo?(job: FalVideoQueueJob, signal: AbortSignal): Promise<Record<string, unknown>>;
  generateFalSpeech?(job: FalSpeechQueueJob, signal: AbortSignal): Promise<Record<string, unknown>>;
}

interface OutboxRow {
  id: string;
  kind: string;
  dedupeKey: string;
  payload: object;
}

const defaultOutboxRetentionHours = 7 * 24;
const outboxCleanupIntervalMs = 60 * 60 * 1000;

/**
 * Sessions for one worker process. See apps/api/src/db-pool.ts.
 * pg-boss also keeps one LISTEN client outside this max.
 * ponytail: fixed split, not a setting. Raise these together if the pooler limit grows.
 */
export const workerDatabasePoolMax = 3;
export const queueDatabasePoolMax = 4;

/**
 * node-pg closes an idle client after 10s by default, and the Supabase session
 * pooler re-runs its setup (`DISCARD ALL`, `pgbouncer.get_auth`) on every new
 * connection. At idle that churn is pure egress, so keep warm clients for five
 * minutes. Applied to the worker pool and to the pool pg-boss opens.
 */
export const workerDatabaseIdleTimeoutMillis = 300_000;

/**
 * Idle pg-boss fetch cadence per queue. pg-boss runs without LISTEN/NOTIFY here
 * (`useListenNotify` defaults to false), so this interval is the delivery
 * latency. The queues a studio user is waiting on stay fast — render-preview,
 * inspect-media, and the speech read at 5s, generate-fal-image at 10s — and only
 * the background queues relax to 30s. The old 1s cadence issued about 547k fetch
 * queries a day against an almost always empty queue.
 */
export const queuePollingSeconds = {
  [inspectionQueue]: 5, // a studio user is waiting on the verdict
  [renderQueue]: 5, // ...and on the first preview frame
  [renderNotifyQueue]: 30,
  [falImageQueue]: 10, // ...and on the first generated still
  [falVideoQueue]: 30,
  [falSpeechQueue]: 5 // ...and on the first spoken line
} as const;

/**
 * pg-boss housekeeping (queue deletion bookkeeping) cadence. The old override
 * ran it every second. This pg-boss build defaults to 24h, so pin the reviewed
 * two minutes instead of tracking the library default.
 */
export const queueMaintenanceIntervalSeconds = 120;

/** Queue size/progress sampling for metrics. 10s bought nothing at idle. */
export const queueMonitorIntervalSeconds = 60;

/**
 * Outbox dispatch cadence. The dispatcher is the crash-window closer for API
 * enqueues, not a latency budget: a row only waits here when the API could not
 * send directly or a pass failed. Every tick costs a `WorkOutbox` scan, so 10s
 * keeps recovery snappy while paying a tenth of the old query volume.
 */
export const outboxDispatchIntervalMs = 10_000;

const guardedPools = new WeakSet<object>();
const guardedQueues = new WeakSet<object>();

/** Idle client errors are events. Without a listener, Node exits the process. */
export function guardDatabasePool(pool: pg.Pool): pg.Pool {
  if (guardedPools.has(pool)) return pool;
  guardedPools.add(pool);
  pool.on("error", (error) => {
    console.error("postgres pool error", error);
  });
  return pool;
}

/** pg-boss forwards pool failures as an error event. No listener exits the process. */
export function guardQueue(boss: PgBoss): void {
  if (guardedQueues.has(boss)) return;
  guardedQueues.add(boss);
  boss.on("error", (error) => {
    console.error("queue error", error);
  });
}

function queueError(error: unknown): Error {
  return error instanceof Error ? error : new Error("queue dispatch failed");
}

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
      expireInSeconds: row.kind === renderQueue ? 300
        : (row.kind === falImageQueue || row.kind === falVideoQueue) ? 1200
          : row.kind === falSpeechQueue ? 600
            : 60
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

/** A refused session must not reject the dispatch timer. The queue logs it and keeps polling. */
export async function dispatchOutboxSafely(pool: pg.Pool, boss: PgBoss): Promise<void> {
  try {
    await dispatchOutbox(pool, boss);
  } catch (error) {
    try {
      boss.emit("error", queueError(error));
    } catch (emitError) {
      console.error("queue error", emitError);
    }
  }
}

export async function startQueueRuntime(
  connectionString: string,
  handlers: QueueHandlers,
  pool = guardDatabasePool(new pg.Pool({
    connectionString,
    max: workerDatabasePoolMax,
    idleTimeoutMillis: workerDatabaseIdleTimeoutMillis
  })),
  outboxRetentionHours = defaultOutboxRetentionHours
) {
  guardDatabasePool(pool);
  // pg-boss hands its whole config object to `new pg.Pool(...)`, so
  // idleTimeoutMillis reaches the queue pool even though pg-boss does not type
  // it; the object stays un-annotated to keep that extra key.
  const queueOptions = {
    connectionString,
    max: queueDatabasePoolMax,
    idleTimeoutMillis: workerDatabaseIdleTimeoutMillis,
    maintenanceIntervalSeconds: queueMaintenanceIntervalSeconds,
    monitorIntervalSeconds: queueMonitorIntervalSeconds
  };
  const boss = await new PgBoss(queueOptions).start();
  guardQueue(boss);
  await boss.createQueue(inspectionQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 60 });
  await boss.createQueue(renderQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 300 });
  await boss.createQueue(falImageQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 600 });
  await boss.createQueue(falVideoQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 1200 });
  await boss.createQueue(falSpeechQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 600 });
  await boss.createQueue(renderNotifyQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 60 });
  await boss.work<InspectionJob>(inspectionQueue, { pollingIntervalSeconds: queuePollingSeconds[inspectionQueue] }, async (jobs: Job<InspectionJob>[]) => {
    const job = jobs[0];
    if (!job) return;
    return handlers.inspect(job.data, job.signal);
  });
  await boss.work<PreviewJob>(renderQueue, { pollingIntervalSeconds: queuePollingSeconds[renderQueue] }, async (jobs: Job<PreviewJob>[]) => {
    const job = jobs[0];
    if (!job) return;
    return handlers.render(job.data, job.signal);
  });
  if (handlers.notifyRender) {
    await boss.work<RenderNotifyJob>(renderNotifyQueue, { pollingIntervalSeconds: queuePollingSeconds[renderNotifyQueue] }, async (jobs: Job<RenderNotifyJob>[]) => {
      const job = jobs[0];
      if (!job) return;
      return handlers.notifyRender!(job.data, job.signal);
    });
  }
  if (handlers.generateFalImage) {
    await boss.work<FalImageQueueJob>(falImageQueue, { pollingIntervalSeconds: queuePollingSeconds[falImageQueue] }, async (jobs: Job<FalImageQueueJob>[]) => {
      const job = jobs[0];
      if (!job) return;
      return handlers.generateFalImage!(job.data, job.signal);
    });
  }
  if (handlers.generateFalVideo) {
    await boss.work<FalVideoQueueJob>(falVideoQueue, { pollingIntervalSeconds: queuePollingSeconds[falVideoQueue] }, async (jobs: Job<FalVideoQueueJob>[]) => {
      const job = jobs[0];
      if (!job) return;
      return handlers.generateFalVideo!(job.data, job.signal);
    });
  }
  if (handlers.generateFalSpeech) {
    await boss.work<FalSpeechQueueJob>(falSpeechQueue, { pollingIntervalSeconds: queuePollingSeconds[falSpeechQueue] }, async (jobs: Job<FalSpeechQueueJob>[]) => {
      const job = jobs[0];
      if (!job) return;
      return handlers.generateFalSpeech!(job.data, job.signal);
    });
  }
  await dispatchOutboxSafely(pool, boss);
  try {
    await cleanupDispatchedOutbox(pool, outboxRetentionHours);
  } catch (error) {
    boss.emit("error", queueError(error));
  }
  // ponytail: 10s keeps the API enqueue crash window small without a full
  // WorkOutbox scan every second. Upgrade: have the API send inline and leave
  // this as a recovery sweep for failed marks.
  const dispatchTimer = setInterval(
    () => void dispatchOutboxSafely(pool, boss),
    outboxDispatchIntervalMs
  );
  // ponytail: one 250-row batch per hour caps cleanup work but may lag a large
  // backlog. Upgrade after measuring cleanup count and oldest-undispatched age.
  const cleanupTimer = setInterval(
    () => void cleanupDispatchedOutbox(pool, outboxRetentionHours).catch((error) => {
      try {
        boss.emit("error", queueError(error));
      } catch (emitError) {
        console.error("queue error", emitError);
      }
    }),
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
