import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { ConflictError, NotFoundError, PostgresProjectRepository } from "../dist/domain.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

test("PostgreSQL projects are owner-scoped, transactional, and idempotent", async () => {
  const schema = `project_test_${randomUUID().replaceAll("-", "_")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema}`
  });
  try {
    const migration = await readFile(
      new URL("../../../prisma/migrations/20260726000000_initial/migration.sql", import.meta.url),
      "utf8"
    );
    await pool.query(migration);
    await pool.query(
      `INSERT INTO "User" (id, state) VALUES ($1, 'active'), ($2, 'active')`,
      ["owner", "other"]
    );

    const projects = new PostgresProjectRepository(pool);
    const project = await projects.create("owner", {
      purpose: "Database proof",
      audience: "Teams",
      tone: "Warm"
    });
    assert.equal(await projects.get("other", project.id), undefined);
    assert.equal((await projects.get("owner", project.id))?.revision, 0);
    assert.equal(
      Number((await pool.query(`SELECT COUNT(*) AS count FROM "Concept" WHERE "projectId" = $1`, [project.id])).rows[0].count),
      3
    );

    const command = {
      command_id: "select-once",
      project_id: project.id,
      base_revision: 0,
      client_timestamp: "diagnostic",
      kind: "select_concept",
      payload: { concept_id: "direct" }
    };
    const [first, duplicate] = await Promise.all([
      projects.command("owner", command),
      projects.command("owner", command)
    ]);
    assert.equal(first.revision, 1);
    assert.deepEqual(duplicate, first);
    assert.equal((await projects.get("owner", project.id))?.revision, 1);
    assert.equal(
      Number((await pool.query(`SELECT COUNT(*) AS count FROM "CommandReceipt" WHERE "projectId" = $1`, [project.id])).rows[0].count),
      1
    );

    await assert.rejects(
      projects.command("other", { ...command, command_id: "wrong-owner" }),
      NotFoundError
    );
    await assert.rejects(
      projects.command("owner", { ...command, command_id: "stale-command" }),
      (error) => {
        assert.ok(error instanceof ConflictError);
        assert.equal(error.authoritativeSnapshot.revision, 1);
        assert.equal(error.authoritativeSnapshot.selected_concept_id, "direct");
        return true;
      }
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
