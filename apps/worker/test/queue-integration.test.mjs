import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PgBoss } from "pg-boss";
import {
  cleanupDispatchedOutbox,
  dispatchOutbox,
  renderQueue
} from "../dist/queue.js";

const enabled = process.env.RUN_QUEUE_INTEGRATION === "1";
const integration = enabled ? test : test.skip;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

integration("an expired lease is recovered once by a replacement worker", async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  const queue = `render-${Date.now()}`;
  const first = await new PgBoss({ connectionString, maintenanceIntervalSeconds: 1 }).start();
  await first.createQueue(queue, { expireInSeconds: 1, retryLimit: 1, retryDelay: 0 });
  const jobId = await first.send(queue, { projectId: "project-1" }, { singletonKey: "project-1:1" });
  assert.ok(jobId);
  let leasedResolve;
  const leased = new Promise((resolve) => { leasedResolve = resolve; });
  await first.work(queue, { pollingIntervalSeconds: .5 }, async () => {
    leasedResolve();
    await new Promise(() => {});
  });
  await leased;
  await first.stop({ graceful: false });

  const replacement = await new PgBoss({ connectionString, maintenanceIntervalSeconds: 1 }).start();
  let completions = 0;
  await replacement.work(queue, { pollingIntervalSeconds: .5 }, async () => {
    completions += 1;
    return { objectKey: "projects/project-1/renders/1.mp4" };
  });
  for (let attempt = 0; attempt < 12 && completions === 0; attempt += 1) await wait(500);
  assert.equal(completions, 1);
  await replacement.stop();
});

integration("stable outbox job IDs close the crash window and cleanup stays bounded", async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  const suffix = randomUUID().replaceAll("-", "_");
  const appSchema = `outbox_${suffix}`;
  const bossSchema = `boss_${suffix}`;
  const admin = new pg.Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${appSchema}"`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${appSchema}` });
  const boss = await new PgBoss({
    connectionString,
    schema: bossSchema,
    maintenanceIntervalSeconds: 1
  }).start();
  try {
    await pool.query(await readFile(
      new URL("../../../prisma/migrations/20260726000000_initial/migration.sql", import.meta.url),
      "utf8"
    ));
    await pool.query(await readFile(
      new URL("../../../prisma/migrations/20260726001000_media_admission/migration.sql", import.meta.url),
      "utf8"
    ));
    await pool.query(await readFile(
      new URL("../../../prisma/migrations/20260801001000_bound_transactional_outbox/migration.sql", import.meta.url),
      "utf8"
    ));
    await boss.createQueue(renderQueue);

    const sendFailureId = randomUUID();
    await pool.query(
      `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload, "createdAt")
       VALUES ($1, $2, 'send-failure', '{}', NOW() - INTERVAL '2 days')`,
      [sendFailureId, renderQueue]
    );
    await assert.rejects(
      () => dispatchOutbox(pool, { send: async () => { throw new Error("send failed"); } }),
      /send failed/
    );
    assert.equal((await pool.query(
      `SELECT "dispatchedAt" FROM "WorkOutbox" WHERE id = $1`,
      [sendFailureId]
    )).rows[0].dispatchedAt, null);
    await pool.query(`DELETE FROM "WorkOutbox" WHERE id = $1`, [sendFailureId]);

    const markRetryId = randomUUID();
    await pool.query(
      `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload, "createdAt")
       VALUES ($1, $2, 'mark-retry', '{"jobId":"job"}', NOW() - INTERVAL '1 day')`,
      [markRetryId, renderQueue]
    );
    let failMark = true;
    const markFailingPool = {
      query(sql, params) {
        if (failMark && sql.includes(`UPDATE "WorkOutbox"`)) {
          failMark = false;
          throw new Error("mark failed");
        }
        return pool.query(sql, params);
      }
    };
    const sendResults = [];
    const observedBoss = {
      async send(...args) {
        const id = await boss.send(...args);
        sendResults.push(id);
        return id;
      }
    };
    await assert.rejects(() => dispatchOutbox(markFailingPool, observedBoss), /mark failed/);
    assert.equal((await pool.query(
      `SELECT "dispatchedAt" FROM "WorkOutbox" WHERE id = $1`,
      [markRetryId]
    )).rows[0].dispatchedAt, null);
    assert.equal(await dispatchOutbox(pool, observedBoss), 1);
    assert.equal(sendResults[0], markRetryId);
    assert.equal(sendResults[1], null, "retry retained the stable outbox job id");
    assert.ok((await pool.query(
      `SELECT "dispatchedAt" FROM "WorkOutbox" WHERE id = $1`,
      [markRetryId]
    )).rows[0].dispatchedAt);
    assert.equal(Number((await admin.query(
      `SELECT COUNT(*) AS count FROM "${bossSchema}".job WHERE id = $1`,
      [markRetryId]
    )).rows[0].count), 1);

    const raceId = randomUUID();
    await pool.query(
      `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload, "createdAt")
       VALUES ($1, $2, 'dispatch-race', '{}', NOW() - INTERVAL '30 days')`,
      [raceId, renderQueue]
    );
    await Promise.all([
      dispatchOutbox(pool, boss),
      cleanupDispatchedOutbox(pool, 168)
    ]);
    const raced = (await pool.query(
      `SELECT "dispatchedAt" FROM "WorkOutbox" WHERE id = $1`,
      [raceId]
    )).rows[0];
    assert.ok(raced.dispatchedAt, "cleanup preserved the row while dispatch marked it recent");

    await pool.query(
      `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload, "createdAt", "dispatchedAt")
       SELECT 'expired-' || value, $1, 'expired-' || value, '{}',
              NOW() - INTERVAL '10 days', NOW() - INTERVAL '8 days'
         FROM generate_series(1, 300) AS value`,
      [renderQueue]
    );
    await pool.query(
      `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload, "createdAt", "dispatchedAt")
       VALUES ('recent', $1, 'recent', '{}', NOW(), NOW()),
              ('never-dispatched', $1, 'never-dispatched', '{}', NOW() - INTERVAL '30 days', NULL)`,
      [renderQueue]
    );
    assert.equal(await cleanupDispatchedOutbox(pool, 168), 250);
    assert.equal(Number((await pool.query(
      `SELECT COUNT(*) AS count FROM "WorkOutbox"
        WHERE id LIKE 'expired-%'`
    )).rows[0].count), 50);
    assert.equal(await cleanupDispatchedOutbox(pool, 168), 50);
    assert.equal(Number((await pool.query(
      `SELECT COUNT(*) AS count FROM "WorkOutbox"
        WHERE id IN ('recent', 'never-dispatched')`
    )).rows[0].count), 2);

    await pool.query(
      `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload, "createdAt")
       SELECT 'pending-' || value, $1, 'pending-' || value, '{}', NOW() - value * INTERVAL '1 second'
         FROM generate_series(1, 2000) AS value`,
      [renderQueue]
    );
    await pool.query(`ANALYZE "WorkOutbox"`);
    const explainClient = await pool.connect();
    try {
      await explainClient.query(`SET enable_seqscan = off`);
      const explained = await explainClient.query(
        `EXPLAIN (FORMAT JSON)
         SELECT id, kind, "dedupeKey", payload
           FROM "WorkOutbox" WHERE "dispatchedAt" IS NULL
          ORDER BY "createdAt" LIMIT 25`
      );
      assert.match(
        JSON.stringify(explained.rows[0]["QUERY PLAN"]),
        /WorkOutbox_undispatched_createdAt_idx/
      );
    } finally {
      explainClient.release();
    }
  } finally {
    await boss.stop();
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${appSchema}" CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS "${bossSchema}" CASCADE`);
    await admin.end();
  }
});
