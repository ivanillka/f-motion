import pg from "pg";

/**
 * Postgres channel the "WorkOutbox" insert trigger notifies (migration
 * 20261020200000_work_outbox_notify). The payload is empty: a NOTIFY only says
 * "there is outbox work", the dispatcher still reads the table.
 */
export const workOutboxChannel = "fmotion_work_outbox";

export interface ListenClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
  on(event: "notification", listener: (message: { channel: string }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  removeAllListeners(): unknown;
}

export interface OutboxListenerOptions {
  connectionString: string;
  channel?: string;
  /** A NOTIFY arrived. */
  onNotify: () => void;
  /** LISTEN is (re)established. Anything sent while it was down was missed, so catch up. */
  onReady?: () => void;
  onError?: (error: unknown) => void;
  /** Connection check while idle. A silent dead socket is found within this window. */
  heartbeatMs?: number;
  heartbeatTimeoutMs?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  createClient?: (connectionString: string) => ListenClient;
}

export interface OutboxListener {
  /** True while LISTEN is registered on a live session. */
  readonly connected: boolean;
  close(): Promise<void>;
}

/**
 * LISTEN needs a session that stays on one Postgres backend. A transaction
 * pooler (Supabase port 6543, or pgbouncer=true) hands each statement to any
 * backend, so a LISTEN there never hears anything. Session mode (the Supabase
 * session pooler on port 5432, or a direct connection) works.
 */
export function listenSupported(connectionString: string, env: Record<string, string | undefined> = {}): boolean {
  if (env.FENGINE_QUEUE_LISTEN?.trim() === "0") return false;
  try {
    const url = new URL(connectionString);
    if (url.port === "6543") return false;
    if (url.searchParams.get("pgbouncer") === "true") return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * One dedicated session that LISTENs on the outbox channel, with heartbeat and
 * capped exponential reconnect. A failure never throws to the caller: the
 * dispatcher keeps its fallback poll and reports through onError.
 */
export function startOutboxListener(options: OutboxListenerOptions): OutboxListener {
  const channel = options.channel ?? workOutboxChannel;
  const heartbeatMs = options.heartbeatMs ?? 60_000;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 5_000;
  const initialBackoffMs = options.initialBackoffMs ?? 1_000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const createClient = options.createClient ?? ((connectionString: string) => new pg.Client({
    connectionString,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000
  }) as unknown as ListenClient);
  const report = (error: unknown) => {
    try {
      options.onError?.(error);
    } catch {
      // A broken reporter must not stop reconnects.
    }
  };

  let closed = false;
  let connected = false;
  let client: ListenClient | undefined;
  let backoffMs = initialBackoffMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const teardown = (current: ListenClient) => {
    if (client !== current) return;
    client = undefined;
    connected = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    current.removeAllListeners();
    current.on("error", () => {});
    void current.end().catch(() => {});
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, delay);
    reconnectTimer.unref?.();
  };

  const drop = (current: ListenClient, error: unknown) => {
    if (client !== current) return;
    report(error);
    teardown(current);
    scheduleReconnect();
  };

  const connect = async () => {
    if (closed) return;
    const current = createClient(options.connectionString);
    client = current;
    current.on("error", (error) => drop(current, error));
    current.on("end", () => drop(current, new Error("outbox listener connection ended")));
    current.on("notification", (message) => {
      if (message.channel === channel) options.onNotify();
    });
    try {
      await current.connect();
      await current.query(`LISTEN "${channel}"`);
    } catch (error) {
      drop(current, error);
      return;
    }
    if (closed || client !== current) {
      teardown(current);
      return;
    }
    connected = true;
    backoffMs = initialBackoffMs;
    heartbeatTimer = setInterval(() => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      void Promise.race([
        current.query("SELECT 1"),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("outbox listener heartbeat timed out")), heartbeatTimeoutMs);
        })
      ]).then(
        () => clearTimeout(timeout),
        (error) => {
          clearTimeout(timeout);
          drop(current, error);
        }
      );
    }, heartbeatMs);
    heartbeatTimer.unref?.();
    options.onReady?.();
  };

  void connect();

  return {
    get connected() {
      return connected;
    },
    async close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      if (client) teardown(client);
    }
  };
}

/**
 * Runs `task` now, or once more right after the running pass if a wake arrives
 * meanwhile. Bursts of notifies collapse into at most one extra pass.
 */
export function coalesce(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let again = false;
  const run = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await task();
        } while (again);
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
  return run;
}
