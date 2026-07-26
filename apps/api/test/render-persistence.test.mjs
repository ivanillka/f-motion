import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PostgresProjectRepository } from "../dist/domain.js";
import { PostgresRenderRepository } from "../dist/render-repository.js";
import { createTestApp } from "../dist/server.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("render state, SSE recovery, cancellation, and immutable result are owner-scoped", async () => {
  const schema = `render_test_${randomUUID().replaceAll("-", "_")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const server = createServer();
  try {
    for (const path of [
      "../../../prisma/migrations/20260726000000_initial/migration.sql",
      "../../../prisma/migrations/20260726001000_media_admission/migration.sql",
      "../../../prisma/migrations/20260726002000_render_events/migration.sql"
    ]) {
      await pool.query(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    await pool.query(`INSERT INTO "User" (id, state) VALUES ('owner', 'active'), ('other', 'active')`);
    const projects = new PostgresProjectRepository(pool);
    const project = await projects.create("owner", { purpose: "Render", audience: "Teams", tone: "Warm" });
    const renders = new PostgresRenderRepository(pool);
    server.on("request", createTestApp({ ownerId: "owner", projects, renders }));
    const origin = await listen(server);

    const createResponse = await fetch(`${origin}/api/projects/${project.id}/render`, { method: "POST" });
    assert.equal(createResponse.status, 202);
    const created = await createResponse.json();
    assert.equal(created.state, "queued");
    assert.equal(await renders.events("other", created.job_id), undefined);
    const queued = await renders.events("owner", created.job_id);
    assert.equal(queued.length, 1);

    assert.equal(await renders.progress(created.job_id, "preparing", 10), true);
    const reconnect = await fetch(`${origin}/api/render-jobs/${created.job_id}/events`, {
      headers: { "last-event-id": queued[0].eventId }
    });
    assert.equal(reconnect.status, 200);
    const stream = await reconnect.text();
    assert.match(stream, /event: progress/);
    assert.match(stream, /"phase":"preparing"/);
    assert.doesNotMatch(stream, /"phase":"queued"/);

    assert.equal(await renders.complete(created.job_id, `projects/${project.id}/renders/0.mp4`, {
      width: 720,
      height: 1280,
      immutable: true
    }), true);
    assert.equal((await renders.result("owner", created.job_id)).stale, false);
    assert.equal(await renders.result("other", created.job_id), undefined);
    assert.equal(await renders.complete(created.job_id, "wrong.mp4", {}), false);

    const cancelled = await renders.create("owner", project.id);
    assert.equal((await renders.cancel("owner", cancelled.jobId)).state, "cancelled");
    assert.equal(await renders.complete(cancelled.jobId, "cancelled.mp4", {}), false);
    assert.equal(await renders.result("owner", cancelled.jobId), undefined);

    await projects.command("owner", {
      command_id: "after-render",
      project_id: project.id,
      base_revision: 0,
      client_timestamp: "diagnostic",
      kind: "select_concept",
      payload: { concept_id: "direct" }
    });
    assert.equal((await renders.result("owner", created.job_id)).stale, true);
    assert.equal(
      Number((await pool.query(`SELECT COUNT(*) AS count FROM "WorkOutbox" WHERE kind = 'render-preview'`)).rows[0].count),
      2
    );
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
