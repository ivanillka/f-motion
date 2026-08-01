import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupDispatchedOutbox,
  dispatchOutbox,
  outboxRetentionHoursFromEnv
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
