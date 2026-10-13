import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  cleanupDispatchedOutbox,
  dispatchOutbox,
  dispatchOutboxSafely,
  falImageQueue,
  falSpeechQueue,
  falVideoQueue,
  guardDatabasePool,
  guardQueue,
  inspectionQueue,
  outboxDispatchIntervalMs,
  outboxRetentionHoursFromEnv,
  queueDatabasePoolMax,
  queueMaintenanceIntervalSeconds,
  queueMonitorIntervalSeconds,
  queuePollingSeconds,
  renderNotifyQueue,
  renderQueue,
  workerDatabaseIdleTimeoutMillis,
  workerDatabasePoolMax
} from "../dist/queue.js";

test("outbox retention defaults to seven days and rejects invalid values", () => {
  assert.equal(outboxRetentionHoursFromEnv({}), 168);
  assert.equal(outboxRetentionHoursFromEnv({ OUTBOX_RETENTION_HOURS: " 24.5 " }), 24.5);
  for (const value of ["0", "-1", "nope", "Infinity", " "]) {
    assert.throws(
      () => outboxRetentionHoursFromEnv({ OUTBOX_RETENTION_HOURS: value }),
      /invalid OUTBOX_RETENTION_HOURS/
    );
  }
});

test("a retained stable pg-boss job id still marks its outbox row dispatched", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes(`SELECT id, kind`)) {
        return {
          rows: [{
            id: "outbox",
            kind: "render-preview",
            dedupeKey: "render:project:1",
            payload: { jobId: "job" }
          }]
        };
      }
      return { rowCount: 1 };
    }
  };
  let sentOptions;
  const boss = {
    async send(_kind, _payload, options) {
      sentOptions = options;
      return null;
    }
  };
  assert.equal(await dispatchOutbox(pool, boss), 1);
  assert.equal(sentOptions.id, "outbox");
  assert.equal(sentOptions.singletonKey, "render:project:1");
  assert.equal(queries.some((sql) => sql.includes(`SET "dispatchedAt" = NOW()`)), true);
});

test("a send error leaves the outbox row undispatched", async () => {
  let marked = false;
  const pool = {
    async query(sql) {
      if (sql.includes(`SELECT id, kind`)) {
        return {
          rows: [{
            id: "outbox",
            kind: "render-preview",
            dedupeKey: "render:project:1",
            payload: { jobId: "job" }
          }]
        };
      }
      marked = true;
      return { rowCount: 1 };
    }
  };
  const boss = { async send() { throw new Error("queue unavailable"); } };
  await assert.rejects(() => dispatchOutbox(pool, boss), /queue unavailable/);
  assert.equal(marked, false);
});

test("database pools stay inside a small shared session pooler", async () => {
  const apiPool = await readFile(new URL("../../api/src/db-pool.ts", import.meta.url), "utf8");
  const apiMax = Number(apiPool.match(/export const apiDatabasePoolMax = (\d+)/)?.[1]);
  assert.equal(apiMax, 4);
  assert.equal(workerDatabasePoolMax, 3);
  assert.equal(queueDatabasePoolMax, 4);
  assert.ok(apiMax + workerDatabasePoolMax + queueDatabasePoolMax <= 12);
  const apiStart = await readFile(new URL("../../api/src/start.ts", import.meta.url), "utf8");
  const workerStart = await readFile(new URL("../src/start.ts", import.meta.url), "utf8");
  const queueSource = await readFile(new URL("../src/queue.ts", import.meta.url), "utf8");
  assert.match(apiStart, /max: apiDatabasePoolMax/);
  assert.match(workerStart, /max: workerDatabasePoolMax/);
  assert.match(queueSource, /max: queueDatabasePoolMax/);
  assert.match(queueSource, /guardQueue\(boss\)/);
  assert.match(queueSource, /dispatchOutboxSafely\(pool, boss\)/);
});

test("idle pools keep warm clients instead of reconnecting every ten seconds", async () => {
  const apiPool = await readFile(new URL("../../api/src/db-pool.ts", import.meta.url), "utf8");
  const apiIdle = Number(
    (apiPool.match(/export const apiDatabaseIdleTimeoutMillis = ([\d_]+)/)?.[1] ?? "").replaceAll("_", "")
  );
  assert.equal(apiIdle, 300_000);
  assert.equal(workerDatabaseIdleTimeoutMillis, 300_000);
  assert.ok(apiIdle > 10_000, "longer than the node-pg default that was churning the pooler");
  const apiStart = await readFile(new URL("../../api/src/start.ts", import.meta.url), "utf8");
  const workerStart = await readFile(new URL("../src/start.ts", import.meta.url), "utf8");
  const queueSource = await readFile(new URL("../src/queue.ts", import.meta.url), "utf8");
  assert.match(apiStart, /idleTimeoutMillis: apiDatabaseIdleTimeoutMillis/);
  assert.match(workerStart, /idleTimeoutMillis: workerDatabaseIdleTimeoutMillis/);
  // The worker pool and the pg-boss pool both get the longer idle window.
  assert.equal(
    queueSource.match(/idleTimeoutMillis: workerDatabaseIdleTimeoutMillis/g)?.length,
    2
  );
});

test("a refused session does not stop the worker", async () => {
  const refused = Object.assign(new Error("max clients reached - pool_size: 15"), {
    code: "EMAXCONNSESSION"
  });
  const pool = new pg.Pool({
    connectionString: "postgres://127.0.0.1:1/postgres",
    max: workerDatabasePoolMax,
    connectionTimeoutMillis: 50
  });
  guardDatabasePool(pool);
  assert.doesNotThrow(() => pool.emit("error", refused));
  await pool.end();

  const boss = new EventEmitter();
  const seen = [];
  boss.on("error", (error) => seen.push(error));
  guardQueue(boss);
  let calls = 0;
  const queries = {
    async query() {
      calls += 1;
      if (calls === 1) throw refused;
      return { rows: [] };
    }
  };
  await dispatchOutboxSafely(queries, boss);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].code, "EMAXCONNSESSION");
  assert.equal(await dispatchOutbox(queries, boss), 0);
  assert.equal(calls, 2);
});

test("cleanup is one bounded parameterized batch", async () => {
  let statement;
  let values;
  const pool = {
    async query(sql, params) {
      statement = sql;
      values = params;
      return { rowCount: 250 };
    }
  };
  assert.equal(await cleanupDispatchedOutbox(pool, 168), 250);
  assert.deepEqual(values, [168]);
  assert.match(statement, /"dispatchedAt" IS NOT NULL/);
  assert.match(statement, /FOR UPDATE SKIP LOCKED/);
  assert.match(statement, /LIMIT 250/);
});

test("idle polling, maintenance, and outbox dispatch stay bounded", async () => {
  assert.deepEqual(
    { ...queuePollingSeconds },
    {
      // Fast where a studio user is waiting on the result.
      [inspectionQueue]: 5,
      [renderQueue]: 5,
      [falImageQueue]: 10,
      // Background: relaxed.
      [renderNotifyQueue]: 30,
      [falVideoQueue]: 30,
      [falSpeechQueue]: 5
    }
  );
  assert.equal(queueMaintenanceIntervalSeconds, 120);
  assert.equal(queueMonitorIntervalSeconds, 60);
  assert.equal(outboxDispatchIntervalMs, 10_000);

  // Source guard: a per-second override must not creep back in, and every
  // worker polls through the map and dispatches on the shared interval.
  const source = await readFile(new URL("../src/queue.ts", import.meta.url), "utf8");
  assert.equal(source.match(/pollingIntervalSeconds: queuePollingSeconds\[/g)?.length, 6);
  assert.doesNotMatch(source, /pollingIntervalSeconds: 1[,}]/);
  assert.doesNotMatch(source, /maintenanceIntervalSeconds: 1[,}]/);
  assert.match(source, /monitorIntervalSeconds: queueMonitorIntervalSeconds/);
  assert.match(source, /dispatchOutboxSafely\(pool, boss\),\s*\n\s*outboxDispatchIntervalMs/);
});

