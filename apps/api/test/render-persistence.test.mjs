import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PostgresProjectRepository } from "../dist/domain.js";
import { PostgresRenderRepository, RenderInputIncompleteError } from "../dist/render-repository.js";
import { createTestApp } from "../dist/server.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required");

const renderMigrations = [
  "../../../prisma/migrations/20260726000000_initial/migration.sql",
  "../../../prisma/migrations/20260726001000_media_admission/migration.sql",
  "../../../prisma/migrations/20260726002000_render_events/migration.sql",
  "../../../prisma/migrations/20260731000000_render_job_input/migration.sql",
  "../../../prisma/migrations/20260731000000_seal_inspected_media/migration.sql",
  "../../../prisma/migrations/20260801000000_coalesce_render_jobs/migration.sql",
  "../../../prisma/migrations/20260801120000_render_kind_profile/migration.sql"
];

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function applyMigrations(pool, paths) {
  for (const path of paths) {
    await pool.query(await readFile(new URL(path, import.meta.url), "utf8"));
  }
}

async function insertReadySealedMedia(pool, { id, ownerId, projectId }) {
  await pool.query(
    `INSERT INTO "MediaAsset" (
       id, "ownerId", "projectId", "quarantineObjectKey", "sealedObjectKey",
       "sealedEtag", "sealedSha256", state, "declaredType", "maxBytes"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', 'video/mp4', 1000000)`,
    [
      id,
      ownerId,
      projectId,
      `projects/${projectId}/media-quarantine/${id}`,
      `projects/${projectId}/media-sealed/${id}`,
      `"etag-${id}"`,
      "a".repeat(64)
    ]
  );
}

/** Project with one scene attached to owned ready sealed media — eligible to enqueue. */
async function seedRenderableProject(projects, pool, ownerId, brief, commandPrefix = randomUUID()) {
  const project = await projects.create(ownerId, brief);
  const selected = await projects.command(ownerId, {
    command_id: `${commandPrefix}-select`,
    project_id: project.id,
    base_revision: 0,
    client_timestamp: "diagnostic",
    kind: "select_concept",
    payload: { concept_id: "direct" }
  });
  const mediaId = `${commandPrefix}-media`;
  await insertReadySealedMedia(pool, { id: mediaId, ownerId, projectId: project.id });
  return projects.command(ownerId, {
    command_id: `${commandPrefix}-attach`,
    project_id: project.id,
    base_revision: selected.revision,
    client_timestamp: "diagnostic",
    kind: "replace_storyboard",
    payload: {
      scenes: [{
        ...selected.scenes[0],
        id: selected.scenes[0].id,
        order: 0,
        media_id: mediaId,
        visual_prompt: selected.scenes[0].visual_prompt ?? "render fixture visual"
      }]
    }
  });
}

test("render state, SSE recovery, cancellation, and immutable result are owner-scoped", async () => {
  const schema = `render_test_${randomUUID().replaceAll("-", "_")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const server = createServer();
  try {
    await applyMigrations(pool, renderMigrations);
    await pool.query(`INSERT INTO "User" (id, state) VALUES ('owner', 'active'), ('other', 'active')`);
    const projects = new PostgresProjectRepository(pool);
    const project = await seedRenderableProject(
      projects,
      pool,
      "owner",
      { purpose: "Render", audience: "Teams", tone: "Warm" },
      "main"
    );
    const renders = new PostgresRenderRepository(pool);
    server.on("request", createTestApp({ ownerId: "owner", projects, renders }));
    const origin = await listen(server);

    const createResponses = await Promise.all(
      Array.from({ length: 8 }, () => fetch(`${origin}/api/projects/${project.id}/render`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "preview" })
      }))
    );
    assert.deepEqual(createResponses.map(({ status }) => status), Array(8).fill(202));
    const createdResponses = await Promise.all(createResponses.map((response) => response.json()));
    assert.equal(new Set(createdResponses.map(({ job_id }) => job_id)).size, 1);
    const created = createdResponses[0];
    assert.equal(created.state, "queued");
    assert.equal(Number((await pool.query(
      `SELECT COUNT(*) AS count FROM "RenderJob" WHERE "projectId" = $1 AND revision = $2`
    , [project.id, project.revision])).rows[0].count), 1);
    assert.equal(Number((await pool.query(
      `SELECT COUNT(*) AS count FROM "WorkOutbox" WHERE kind = 'render-preview'`
    )).rows[0].count), 1);
    const finalJob = await renders.create("owner", project.id, "final");
    assert.notEqual(finalJob.jobId, created.job_id);
    assert.deepEqual(finalJob.renderProfile, { width: 1080, height: 1920 });
    assert.equal((await renders.cancel("owner", finalJob.jobId)).state, "cancelled");
    assert.equal(await renders.events("other", created.job_id), undefined);
    const queued = await renders.events("owner", created.job_id);
    assert.equal(queued.length, 1);

    assert.equal(await renders.progress(created.job_id, "preparing", 10), true);
    const reconnectPromise = fetch(`${origin}/api/render-jobs/${created.job_id}/events`, {
      headers: { "last-event-id": queued[0].eventId }
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(await renders.complete(created.job_id, `projects/${project.id}/renders/${project.revision}.mp4`, {
      width: 720,
      height: 1280,
      immutable: true
    }), true);
    const reconnect = await reconnectPromise;
    assert.equal(reconnect.status, 200);
    const stream = await reconnect.text();
    assert.match(stream, /event: progress/);
    assert.match(stream, /"phase":"preparing"/);
    assert.match(stream, /"phase":"complete"/);
    assert.doesNotMatch(stream, /"phase":"queued"/);
    assert.equal((await renders.result("owner", created.job_id)).stale, false);
    assert.equal(await renders.result("other", created.job_id), undefined);
    assert.equal(await renders.complete(created.job_id, "wrong.mp4", {}), false);
    assert.equal((await renders.create("owner", project.id, "preview")).jobId, created.job_id,
      "a completed revision remains the canonical response");

    const bumped = await projects.command("owner", {
      command_id: "bump-revision",
      project_id: project.id,
      base_revision: project.revision,
      client_timestamp: "diagnostic",
      kind: "update_scene",
      payload: { scene: { ...project.scenes[0], caption: "Revision bump" } }
    });
    const cancelled = await renders.create("owner", project.id, "preview");
    assert.equal((await renders.cancel("owner", cancelled.jobId)).state, "cancelled");
    assert.equal(await renders.complete(cancelled.jobId, "cancelled.mp4", {}), false);
    assert.equal(await renders.result("owner", cancelled.jobId), undefined);
    const retryAfterCancellation = await renders.create("owner", project.id, "preview");
    assert.notEqual(retryAfterCancellation.jobId, cancelled.jobId);
    await pool.query(`UPDATE "RenderJob" SET state = 'failed' WHERE id = $1`, [retryAfterCancellation.jobId]);
    const retryAfterFailure = await renders.create("owner", project.id, "preview");
    assert.notEqual(retryAfterFailure.jobId, retryAfterCancellation.jobId);
    assert.equal((await renders.cancel("owner", retryAfterFailure.jobId)).state, "cancelled");

    const capacityProjects = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      seedRenderableProject(
        projects,
        pool,
        "owner",
        { purpose: `Capacity ${index}`, audience: "Teams", tone: "Warm" },
        `cap-${index}`
      )
    ));
    const running = await renders.create("owner", capacityProjects[0].id, "preview");
    assert.ok(running);
    assert.equal(await renders.progress(running.jobId, "preparing", 10), true);
    const waitingOne = await renders.create("owner", capacityProjects[1].id, "preview");
    const waitingTwo = await renders.create("owner", capacityProjects[2].id, "preview");
    assert.ok(waitingOne);
    assert.ok(waitingTwo);
    await assert.rejects(
      () => renders.create("owner", capacityProjects[3].id, "preview"),
      /render capacity reached/
    );
    assert.equal((await fetch(`${origin}/api/projects/${capacityProjects[3].id}/render`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "preview" })
    })).status, 429);
    assert.equal((await renders.cancel("owner", waitingOne.jobId)).state, "cancelled");
    assert.ok(await renders.create("owner", capacityProjects[3].id, "preview"), "terminal jobs release capacity");

    await pool.query(
      `UPDATE "RenderJob" SET state = 'cancelled'
        WHERE "ownerId" = 'owner' AND state IN ('queued', 'running')`
    );
    const concurrentProjects = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      seedRenderableProject(
        projects,
        pool,
        "owner",
        { purpose: `Concurrent ${index}`, audience: "Teams", tone: "Warm" },
        `conc-${index}`
      )
    ));
    const concurrent = await Promise.allSettled(concurrentProjects.map(({ id }) => renders.create("owner", id, "preview")));
    assert.equal(
      concurrent.filter(({ status }) => status === "fulfilled").length,
      3,
      "owner lock must admit only three concurrent attempts"
    );
    assert.equal(
      Number((await pool.query(
        `SELECT COUNT(*) AS count FROM "RenderJob"
          WHERE "ownerId" = 'owner' AND state IN ('queued', 'running')`
      )).rows[0].count),
      3
    );

    await pool.query(
      `UPDATE "RenderJob" SET state = 'cancelled'
        WHERE "ownerId" = 'owner' AND state IN ('queued', 'running')`
    );
    await insertReadySealedMedia(pool, { id: "media-n", ownerId: "owner", projectId: project.id });
    await insertReadySealedMedia(pool, { id: "media-n-plus-1", ownerId: "owner", projectId: project.id });
    const sceneN = { ...bumped.scenes[0], caption: "Frozen revision N", media_id: "media-n" };
    const revisionN = await projects.command("owner", {
      command_id: "freeze-scene",
      project_id: project.id,
      base_revision: bumped.revision,
      client_timestamp: "diagnostic",
      kind: "update_scene",
      payload: { scene: sceneN }
    });
    const frozenJob = await renders.create("owner", project.id, "preview");
    assert.ok(frozenJob);
    await projects.command("owner", {
      command_id: "mutate-after-enqueue",
      project_id: project.id,
      base_revision: revisionN.revision,
      client_timestamp: "diagnostic",
      kind: "update_scene",
      payload: { scene: { ...sceneN, caption: "Mutable revision N+1", media_id: "media-n-plus-1" } }
    });
    const stored = (await pool.query(
      `SELECT revision, "renderInput" FROM "RenderJob" WHERE id = $1`,
      [frozenJob.jobId]
    )).rows[0];
    assert.equal(stored.revision, revisionN.revision);
    assert.equal(stored.renderInput.revision, revisionN.revision);
    assert.equal(stored.renderInput.scenes[0].caption, "Frozen revision N");
    assert.equal(stored.renderInput.scenes[0].media_id, "media-n");
    assert.equal(stored.renderInput.scenes[0].order, 0);
    assert.equal(await renders.complete(frozenJob.jobId, `projects/${project.id}/renders/${revisionN.revision}.mp4`, {
      revision: revisionN.revision,
      immutable: true
    }), true);
    assert.equal((await renders.result("owner", frozenJob.jobId)).stale, true);
    assert.equal((await renders.result("owner", created.job_id)).stale, true);
    assert.equal(
      Number((await pool.query(`SELECT COUNT(*) AS count FROM "WorkOutbox" WHERE kind = 'render-preview'`)).rows[0].count),
      Number((await pool.query(`SELECT COUNT(*) AS count FROM "RenderJob"`)).rows[0].count),
      "every admitted job has one outbox row"
    );
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});

test("render enqueue rejects empty, missing, foreign, and non-ready media", async () => {
  const schema = `render_incomplete_${randomUUID().replaceAll("-", "_")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const server = createServer();
  try {
    await applyMigrations(pool, renderMigrations);
    await pool.query(
      `INSERT INTO "User" (id, state) VALUES ('owner', 'active'), ('other', 'active')`
    );
    const projects = new PostgresProjectRepository(pool);
    const renders = new PostgresRenderRepository(pool);
    server.on("request", createTestApp({ ownerId: "owner", projects, renders }));
    const origin = await listen(server);

    const empty = await projects.create("owner", { purpose: "Empty", audience: "Teams", tone: "Warm" });
    await assert.rejects(
      () => renders.create("owner", empty.id, "preview"),
      (error) => error instanceof RenderInputIncompleteError
    );
    assert.equal((await fetch(`${origin}/api/projects/${empty.id}/render`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "preview" })
    })).status, 422);

    const selected = await projects.command("owner", {
      command_id: "select-no-media",
      project_id: empty.id,
      base_revision: 0,
      client_timestamp: "diagnostic",
      kind: "select_concept",
      payload: { concept_id: "direct" }
    });
    const noMediaResponse = await fetch(`${origin}/api/projects/${empty.id}/render`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "preview" })
    });
    assert.equal(noMediaResponse.status, 422);
    assert.equal((await noMediaResponse.json()).type, "render_input_incomplete");

    const foreignProject = await projects.create("other", {
      purpose: "Other",
      audience: "Teams",
      tone: "Warm"
    });
    await insertReadySealedMedia(pool, {
      id: "foreign-media",
      ownerId: "other",
      projectId: foreignProject.id
    });
    await projects.command("owner", {
      command_id: "attach-foreign",
      project_id: empty.id,
      base_revision: selected.revision,
      client_timestamp: "diagnostic",
      kind: "update_scene",
      payload: { scene: { ...selected.scenes[0], media_id: "foreign-media" } }
    });
    await assert.rejects(
      () => renders.create("owner", empty.id, "preview"),
      (error) => error instanceof RenderInputIncompleteError
    );

    const missing = await projects.command("owner", {
      command_id: "attach-missing",
      project_id: empty.id,
      base_revision: selected.revision + 1,
      client_timestamp: "diagnostic",
      kind: "update_scene",
      payload: { scene: { ...selected.scenes[0], media_id: "does-not-exist" } }
    });
    await assert.rejects(
      () => renders.create("owner", empty.id, "preview"),
      (error) => error instanceof RenderInputIncompleteError
    );

    await insertReadySealedMedia(pool, {
      id: "inspecting-media",
      ownerId: "owner",
      projectId: empty.id
    });
    await pool.query(`UPDATE "MediaAsset" SET state = 'inspecting',
      "sealedObjectKey" = NULL, "sealedEtag" = NULL, "sealedSha256" = NULL
      WHERE id = 'inspecting-media'`);
    const inspecting = await projects.command("owner", {
      command_id: "attach-inspecting",
      project_id: empty.id,
      base_revision: missing.revision,
      client_timestamp: "diagnostic",
      kind: "update_scene",
      payload: { scene: { ...selected.scenes[0], media_id: "inspecting-media" } }
    });
    await assert.rejects(
      () => renders.create("owner", empty.id, "preview"),
      (error) => error instanceof RenderInputIncompleteError
    );

    await pool.query(
      `UPDATE "MediaAsset" SET state = 'rejected',
         "sealedObjectKey" = NULL, "sealedEtag" = NULL, "sealedSha256" = NULL
       WHERE id = 'inspecting-media'`
    );
    await assert.rejects(
      () => renders.create("owner", empty.id, "preview"),
      (error) => error instanceof RenderInputIncompleteError
    );

    await insertReadySealedMedia(pool, { id: "ready-media", ownerId: "owner", projectId: empty.id });
    await projects.command("owner", {
      command_id: "attach-ready",
      project_id: empty.id,
      base_revision: inspecting.revision,
      client_timestamp: "diagnostic",
      kind: "replace_storyboard",
      payload: {
        scenes: [{
          ...selected.scenes[0],
          order: 0,
          media_id: "ready-media",
          visual_prompt: selected.scenes[0].visual_prompt ?? "ready fixture visual"
        }]
      }
    });
    const ok = await renders.create("owner", empty.id, "preview");
    assert.equal(ok.state, "queued");
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS count FROM "RenderJob"`)).rows[0].count), 1);
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});

test("render-input migration refuses to relabel an ambiguous historical job", async () => {
  const schema = `render_migration_${randomUUID().replaceAll("-", "_")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  try {
    for (const path of [
      "../../../prisma/migrations/20260726000000_initial/migration.sql",
      "../../../prisma/migrations/20260726001000_media_admission/migration.sql",
      "../../../prisma/migrations/20260726002000_render_events/migration.sql"
    ]) {
      await pool.query(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    await pool.query(`INSERT INTO "User" (id, state) VALUES ('owner', 'active')`);
    await pool.query(
      `INSERT INTO "Project" (id, "ownerId", revision, brief)
       VALUES ('project', 'owner', 1, '{"purpose":"Current","audience":"Teams","tone":"Warm"}');
       INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, state)
       VALUES ('safe', 'owner', 'project', 1, 'queued'),
              ('ambiguous', 'owner', 'project', 0, 'queued')`
    );
    await pool.query(await readFile(
      new URL("../../../prisma/migrations/20260731000000_render_job_input/migration.sql", import.meta.url),
      "utf8"
    ));
    const jobs = (await pool.query(
      `SELECT id, state, "renderInput" FROM "RenderJob" ORDER BY id`
    )).rows;
    assert.equal(jobs[0].id, "ambiguous");
    assert.equal(jobs[0].state, "failed");
    assert.equal(jobs[0].renderInput.migration_error, "historical render input unavailable");
    assert.deepEqual((await pool.query(
      `SELECT phase, percent FROM "RenderEvent" WHERE "jobId" = 'ambiguous' ORDER BY id`
    )).rows, [{ phase: "failed", percent: 0 }]);
    assert.equal(jobs[1].id, "safe");
    assert.equal(jobs[1].state, "queued");
    assert.equal(jobs[1].renderInput.revision, 1);
    assert.equal(Number((await pool.query(
      `SELECT COUNT(*) AS count FROM "RenderEvent" WHERE "jobId" = 'safe'`
    )).rows[0].count), 0);
    await assert.rejects(
      () => pool.query(
        `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, state)
         VALUES ('missing-input', 'owner', 'project', 1, 'queued')`
      ),
      /renderInput/
    );
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
