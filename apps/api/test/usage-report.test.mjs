import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

// Replays the usage report migration into a scratch schema with its own
// "UsageLedger", so the global views in public data are not touched.
const enabled = process.env.RUN_PROJECT_INTEGRATION === "1";
const integration = enabled ? test : test.skip;
const migration = readFileSync(
  new URL("../../../prisma/migrations/20261027200000_usage_report_views/migration.sql", import.meta.url),
  "utf8"
);

export async function seedAndReport(query, schema) {
  await query(`CREATE SCHEMA ${schema}`);
  await query(`SET search_path TO ${schema}`);
  await query(`CREATE TABLE "UsageLedger" (
    id text PRIMARY KEY, "ownerId" text NOT NULL, delta int NOT NULL,
    reason text NOT NULL, "idempotencyKey" text NOT NULL, "createdAt" timestamp NOT NULL)`);
  await query(migration.replaceAll("fmotion_report", schema));
  const rows = [
    // a: signs up week 1, renders weeks 1 and 2 (retained, returning in week 2)
    ["a", "free_grant", "2026-10-05"], ["a", "render_preview", "2026-10-05"], ["a", "render_final", "2026-10-06"],
    ["a", "render_final", "2026-10-13"], ["a", "render_final", "2026-10-14"],
    // b: signs up week 1, comes back only in week 3 (returning, not retained)
    ["b", "free_grant", "2026-10-07"], ["b", "render_final", "2026-10-21"],
    // c: signs up week 2 and renders the same week (new, not returning)
    ["c", "free_grant", "2026-10-12"], ["c", "render_final", "2026-10-15"], ["c", "top_up", "2026-10-15"]
  ];
  let n = 0;
  for (const [owner, reason, at] of rows) {
    n += 1;
    await query(
      `INSERT INTO "UsageLedger" VALUES ($1, $2, 1, $3, $4, $5)`,
      [String(n), owner, reason, `k${n}`, `${at}T12:00:00`]
    );
  }
  const summary = await query(`SELECT *, week_start::text AS week FROM ${schema}.weekly_summary ORDER BY week_start`);
  const perUser = await query(`SELECT * FROM ${schema}.weekly_user_usage ORDER BY week_start, owner_id`);
  return { summary, perUser };
}

export function assertReport({ summary, perUser }) {
  const brief = summary.map((row) => ({
    week: row.week,
    active: Number(row.active_users),
    new: Number(row.new_users),
    returning: Number(row.returning_users),
    retained: Number(row.retained_users),
    reels: Number(row.reels),
    previews: Number(row.previews),
    rate: row.return_rate === null ? null : Number(row.return_rate)
  }));
  assert.deepEqual(brief, [
    { week: "2026-10-05", active: 1, new: 2, returning: 0, retained: 0, reels: 1, previews: 1, rate: 0 },
    { week: "2026-10-12", active: 2, new: 1, returning: 1, retained: 1, reels: 3, previews: 0, rate: 0.5 },
    { week: "2026-10-19", active: 1, new: 0, returning: 1, retained: 0, reels: 1, previews: 0, rate: 1 }
  ]);
  assert.equal(perUser.length, 4);
  assert.ok(summary.every((row) => !("owner_id" in row)), "summary must not expose user ids");
}

integration("weekly usage report counts reels, new, returning and retained users", async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const schema = `usage_report_${process.pid}_${Date.now()}`;
  try {
    const query = async (sql, params) => (await pool.query(sql, params)).rows;
    assertReport(await seedAndReport(query, schema));
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  }
});
