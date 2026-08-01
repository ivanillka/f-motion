import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function createProject(origin, purpose) {
  const response = await fetch(`${origin}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose })
  });
  assert.equal(response.status, 201);
  return (await response.json()).project;
}

test("GET /api/projects lists only the authenticated owner's projects", async () => {
  const projects = new ProjectService();
  const ownerA = createServer(createTestApp({ ownerId: "owner-a", projects }));
  const ownerB = createServer(createTestApp({ ownerId: "owner-b", projects }));
  const originA = await listen(ownerA);
  const originB = await listen(ownerB);
  try {
    const first = await createProject(originA, "First draft");
    const second = await createProject(originA, "Second draft");
    await createProject(originB, "Other owner draft");

    const listed = await fetch(`${originA}/api/projects`);
    assert.equal(listed.status, 200);
    const body = await listed.json();
    assert.equal(body.projects.length, 2);
    assert.deepEqual(
      body.projects.map(({ id }) => id).sort(),
      [first.id, second.id].sort()
    );
    assert.ok(body.projects.every(({ brief }) => brief.purpose.startsWith("First") || brief.purpose.startsWith("Second")));
  } finally {
    await Promise.all([
      new Promise((resolve, reject) => ownerA.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => ownerB.close((error) => error ? reject(error) : resolve()))
    ]);
  }
});

test("GET /api/projects returns an empty list for a new owner", async () => {
  const server = createServer(createTestApp({ ownerId: "empty-owner" }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/projects`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projects: [] });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("GET /api/projects/:projectId returns a snapshot or 404 across owners", async () => {
  const projects = new ProjectService();
  const ownerA = createServer(createTestApp({ ownerId: "owner-a", projects }));
  const ownerB = createServer(createTestApp({ ownerId: "owner-b", projects }));
  const originA = await listen(ownerA);
  const originB = await listen(ownerB);
  try {
    const project = await createProject(originA, "Reopen me");

    const found = await fetch(`${originA}/api/projects/${project.id}`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).project.id, project.id);

    const missing = await fetch(`${originB}/api/projects/${project.id}`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).type, "not_found");

    const unknown = await fetch(`${originA}/api/projects/${crypto.randomUUID()}`);
    assert.equal(unknown.status, 404);
  } finally {
    await Promise.all([
      new Promise((resolve, reject) => ownerA.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => ownerB.close((error) => error ? reject(error) : resolve()))
    ]);
  }
});
