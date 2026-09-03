import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import {
  ProjectBusyError,
  collectProjectObjectKeys,
  projectHasActiveJobs,
  purgeProject
} from "../dist/project-purge.js";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function createFakePurgePool({
  exists = true,
  activeRender = false,
  activeGeneration = false,
  media = [],
  renders = [],
  failDelete = false
} = {}) {
  const deleted = { project: false, outbox: false };
  const query = async (sql, params = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes(`FROM "Project"`) && sql.includes("FOR UPDATE")) {
      return { rows: exists ? [{ id: params[1] }] : [] };
    }
    if (sql.includes(`FROM "RenderJob"`) && sql.includes("state::text")) {
      return { rows: activeRender ? [{ one: 1 }] : [] };
    }
    if (sql.includes(`FROM "GenerationJob"`)) {
      return { rows: activeGeneration ? [{ one: 1 }] : [] };
    }
    if (sql.includes(`FROM "MediaAsset"`)) {
      return { rows: media };
    }
    if (sql.includes(`FROM "RenderResult"`)) {
      return { rows: renders };
    }
    if (sql.includes(`DELETE FROM "WorkOutbox"`)) {
      deleted.outbox = true;
      return { rowCount: 1 };
    }
    if (sql.includes(`DELETE FROM "Project"`)) {
      if (failDelete) return { rowCount: 0 };
      deleted.project = true;
      return { rowCount: 1 };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  return {
    connect: async () => ({ query, release() {} }),
    query,
    deleted
  };
}

test("in-memory DELETE /api/projects/:id removes the draft and later GET is 404", async () => {
  const projects = new ProjectService();
  const server = createServer(createTestApp({ ownerId: "owner", projects }));
  const origin = await listen(server);
  try {
    const created = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Ephemeral one" })
    });
    assert.equal(created.status, 201);
    const project = (await created.json()).project;

    const deleted = await fetch(`${origin}/v1/projects/${project.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), {
      project_id: project.id,
      deleted: true,
      storage_failures: []
    });

    const missing = await fetch(`${origin}/api/projects/${project.id}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).type, "not_found");

    const listed = await fetch(`${origin}/api/projects`);
    assert.deepEqual((await listed.json()).projects, []);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("DELETE refuses another owner's project", async () => {
  const projects = new ProjectService();
  const ownerA = createServer(createTestApp({ ownerId: "owner-a", projects }));
  const ownerB = createServer(createTestApp({ ownerId: "owner-b", projects }));
  const originA = await listen(ownerA);
  const originB = await listen(ownerB);
  try {
    const created = await fetch(`${originA}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Keep mine" })
    });
    const project = (await created.json()).project;
    const denied = await fetch(`${originB}/api/projects/${project.id}`, { method: "DELETE" });
    assert.equal(denied.status, 404);
    assert.equal((await fetch(`${originA}/api/projects/${project.id}`)).status, 200);
  } finally {
    await Promise.all([
      new Promise((resolve, reject) => ownerA.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => ownerB.close((error) => error ? reject(error) : resolve()))
    ]);
  }
});

test("DELETE reports conflict when purge says the project is busy", async () => {
  const projects = new ProjectService();
  const server = createServer(createTestApp({
    ownerId: "owner",
    projects,
    purgeProject: async () => {
      throw new ProjectBusyError();
    }
  }));
  const origin = await listen(server);
  try {
    const created = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Busy render" })
    });
    const project = (await created.json()).project;
    const denied = await fetch(`${origin}/api/projects/${project.id}`, { method: "DELETE" });
    assert.equal(denied.status, 409);
    assert.equal((await denied.json()).type, "conflict");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("collectProjectObjectKeys unions media and render keys", async () => {
  const pool = createFakePurgePool({
    media: [
      { quarantineObjectKey: "q1", sealedObjectKey: "s1" },
      { quarantineObjectKey: "q2", sealedObjectKey: "s1" }
    ],
    renders: [{ objectKey: "r1" }]
  });
  assert.deepEqual(
    await collectProjectObjectKeys(pool, "owner", "project"),
    ["q1", "s1", "q2", "r1"]
  );
});

test("projectHasActiveJobs is true for in-flight render or generation", async () => {
  assert.equal(await projectHasActiveJobs(createFakePurgePool(), "o", "p"), false);
  assert.equal(await projectHasActiveJobs(createFakePurgePool({ activeRender: true }), "o", "p"), true);
  assert.equal(await projectHasActiveJobs(createFakePurgePool({ activeGeneration: true }), "o", "p"), true);
});

test("purgeProject deletes DB then storage keys and reports failures", async () => {
  const pool = createFakePurgePool({
    media: [{ quarantineObjectKey: "q1", sealedObjectKey: "s1" }],
    renders: [{ objectKey: "r1" }]
  });
  const deleted = [];
  const result = await purgeProject(pool, {
    async delete(key) {
      deleted.push(key);
      if (key === "s1") throw new Error("denied");
    }
  }, "owner", "project");
  assert.equal(pool.deleted.project, true);
  assert.equal(pool.deleted.outbox, true);
  assert.deepEqual(deleted, ["q1", "s1", "r1"]);
  assert.deepEqual(result, {
    project_id: "project",
    deleted: true,
    storage_failures: ["s1"]
  });
});

test("purgeProject refuses active jobs and skips storage", async () => {
  const pool = createFakePurgePool({ activeRender: true });
  const deleted = [];
  await assert.rejects(
    () => purgeProject(pool, { async delete(key) { deleted.push(key); } }, "owner", "project"),
    ProjectBusyError
  );
  assert.equal(pool.deleted.project, false);
  assert.deepEqual(deleted, []);
});

test("purgeProject returns undefined when the project is missing", async () => {
  const pool = createFakePurgePool({ exists: false });
  assert.equal(await purgeProject(pool, { async delete() {} }, "owner", "missing"), undefined);
});
