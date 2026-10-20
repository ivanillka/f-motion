import { renderNotifyQueue, type RenderNotifyJob } from "@f-engine/contracts/host-notify";
import pg from "pg";
import { PgBoss, type Job } from "pg-boss";
import { coalesce, listenSupported, startOutboxListener, type OutboxListener } from "./outbox-wake.js";

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
 * The outbox listener keeps one LISTEN session outside this max (pg-boss's own
 * LISTEN stays off), so the worker holds at most 3 + 4 + 1.
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
 * Delivery is push, not poll. The API (and the worker itself) only ever writes
 * "WorkOutbox" rows; an insert trigger NOTIFYs `fmotion_work_outbox`, the
 * worker's listener dispatches the rows to pg-boss at once, and the dispatcher
 * wakes the matching pg-boss worker in process (`notifyWorker`). Pickup is
 * tens of milliseconds instead of up to outbox 10s plus queue 30s.
 *
 * So the pg-boss fetch poll is only a safety net (retries that become runnable
 * later, jobs from another process): one empty fetch per queue per minute.
 */
export const queuePollingSeconds = {
  [inspectionQueue]: 60,
  [renderQueue]: 60,
  [renderNotifyQueue]: 60,
  [falImageQueue]: 60,
  [falVideoQueue]: 60,
  [falSpeechQueue]: 60
} as const;

/**
 * pg-boss housekeeping. Supervise is the tick that runs the monitor (expired
 * leases, queue stats) and maintenance (deletion) gates, so all three relax
 * together. Expiry still fires within two minutes of a lease running out.
 */
export const queueSuperviseIntervalSeconds = 120;
export const queueMaintenanceIntervalSeconds = 600;
export const queueMonitorIntervalSeconds = 120;

/**
 * pg-boss loops F-Motion does not use. No cron schedules (`schedule: false`
 * stops the 5s send-it fetch and the 30s cron check), no flows (navigator
 * every 5s by default), and the queue cache only changes when this process
 * creates queues, which evicts it anyway.
 */
export const queueBackgroundOptions = {
  schedule: false,
  flowIntervalSeconds: 300,
  queueCacheIntervalSeconds: 300,
  bamIntervalSeconds: 600
} as const;

/**
 * Outbox fallback. With the listener up, the timer only sweeps once a minute
 * (crash window closer for failed marks). While LISTEN is down or unsupported,
 * the dispatcher goes back to the old 10s cadence, so delivery degrades to
 * today's behavior instead of stopping.
 */
export const outboxDispatchIntervalMs = 10_000;
export const outboxFallbackIntervalMs = 60_000;

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

export async function dispatchOutbox(
  pool: pg.Pool,
  boss: PgBoss,
  onSent?: (kind: string) => void
): Promise<number> {
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
    onSent?.(row.kind);
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
export async function dispatchOutboxSafely(
  pool: pg.Pool,
  boss: PgBoss,
  onSent?: (kind: string) => void
): Promise<void> {
  try {
    await dispatchOutbox(pool, boss, onSent);
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
  outboxRetentionHours = defaultOutboxRetentionHours,
  env: Record<string, string | undefined> = process.env
) {
  guardDatabasePool(pool);
  // pg-boss hands its whole config object to `new pg.Pool(...)`, so
  // idleTimeoutMillis reaches the queue pool even though pg-boss does not type
  // it; the object stays un-annotated to keep that extra key.
  const queueOptions = {
    connectionString,
    max: queueDatabasePoolMax,
    idleTimeoutMillis: workerDatabaseIdleTimeoutMillis,
    superviseIntervalSeconds: queueSuperviseIntervalSeconds,
    maintenanceIntervalSeconds: queueMaintenanceIntervalSeconds,
    monitorIntervalSeconds: queueMonitorIntervalSeconds,
    ...queueBackgroundOptions
  };
  const boss = await new PgBoss(queueOptions).start();
  guardQueue(boss);
  await boss.createQueue(inspectionQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 60 });
  await boss.createQueue(renderQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 300 });
  await boss.createQueue(falImageQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 600 });
  await boss.createQueue(falVideoQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 1200 });
  await boss.createQueue(falSpeechQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 600 });
  await boss.createQueue(renderNotifyQueue, { retryLimit: 2, retryDelay: 1, expireInSeconds: 60 });
  const workers = new Map<string, string>();
  const work = async <T extends object>(
    name: keyof typeof queuePollingSeconds,
    handler: (data: T, signal: AbortSignal) => Promise<Record<string, unknown>>
  ) => {
    workers.set(name, await boss.work<T>(name, { pollingIntervalSeconds: queuePollingSeconds[name] }, async (jobs: Job<T>[]) => {
      const job = jobs[0];
      if (!job) return;
      return handler(job.data, job.signal);
    }));
  };
  await work<InspectionJob>(inspectionQueue, handlers.inspect);
  await work<PreviewJob>(renderQueue, handlers.render);
  if (handlers.notifyRender) await work<RenderNotifyJob>(renderNotifyQueue, handlers.notifyRender);
  if (handlers.generateFalImage) await work<FalImageQueueJob>(falImageQueue, handlers.generateFalImage);
  if (handlers.generateFalVideo) await work<FalVideoQueueJob>(falVideoQueue, handlers.generateFalVideo);
  if (handlers.generateFalSpeech) await work<FalSpeechQueueJob>(falSpeechQueue, handlers.generateFalSpeech);

  // A sent job wakes its worker in this process, so a fresh job is fetched now
  // rather than at the next fallback poll.
  const wakeWorker = (kind: string) => {
    const id = workers.get(kind);
    if (id) boss.notifyWorker(id);
  };
  let lastDispatchAt = 0;
  const dispatch = coalesce(async () => {
    lastDispatchAt = Date.now();
    await dispatchOutboxSafely(pool, boss, wakeWorker);
  });
  const emitError = (error: unknown) => {
    try {
      boss.emit("error", queueError(error));
    } catch (emitError) {
      console.error("queue error", emitError);
    }
  };

  let listener: OutboxListener | undefined;
  if (listenSupported(connectionString, env)) {
    listener = startOutboxListener({
      connectionString,
      onNotify: () => void dispatch(),
      onReady: () => void dispatch(),
      onError: (error) => console.error("outbox listener error", error instanceof Error ? error.message : error)
    });
  } else {
    console.error("outbox listener off (transaction pooler or FENGINE_QUEUE_LISTEN=0); polling the outbox every 10s");
  }

  await dispatch();
  try {
    await cleanupDispatchedOutbox(pool, outboxRetentionHours);
  } catch (error) {
    emitError(error);
  }
  // Fallback sweep: every minute while the listener is live, every 10s while it
  // is down, so a lost NOTIFY or a failed mark is never stuck for long.
  const dispatchTimer = setInterval(() => {
    const due = listener?.connected ? outboxFallbackIntervalMs : outboxDispatchIntervalMs;
    if (Date.now() - lastDispatchAt >= due - 50) void dispatch();
  }, outboxDispatchIntervalMs);
  // ponytail: one 250-row batch per hour caps cleanup work but may lag a large
  // backlog. Upgrade after measuring cleanup count and oldest-undispatched age.
  const cleanupTimer = setInterval(
    () => void cleanupDispatchedOutbox(pool, outboxRetentionHours).catch(emitError),
    outboxCleanupIntervalMs
  );
  dispatchTimer.unref();
  cleanupTimer.unref();
  return {
    boss,
    pool,
    listener,
    stop: async () => {
      clearInterval(dispatchTimer);
      clearInterval(cleanupTimer);
      await listener?.close();
      await boss.stop();
      await pool.end();
    }
  };
}
