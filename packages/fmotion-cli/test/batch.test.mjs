import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FmotionClient } from "../dist/client.js";
import { batchReels, loadBatchManifest } from "../dist/batch.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  return `http://127.0.0.1:${address.port}`;
}

function composeFake({ quotaAfter = Infinity } = {}) {
  let nextId = 1;
  let renderCount = 0;
  const hits = [];
  const deleted = [];
  const leftover = new Set();
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/v1/projects") {
      const id = `p${nextId}`;
      nextId += 1;
      leftover.add(id);
      response.statusCode = 201;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ project: { id, revision: 0, scenes: [] } }));
      return;
    }
    const command = url.pathname.match(/^\/v1\/projects\/([^/]+)\/commands$/);
    if (request.method === "POST" && command) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        id: command[1],
        revision: 1,
        scenes: [{ id: "s1", order: 0, duration_ms: 3000, media_id: "m1" }]
      }));
      return;
    }
    const getProject = url.pathname.match(/^\/v1\/projects\/([^/]+)$/);
    if (request.method === "GET" && getProject) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        project: {
          id: getProject[1],
          revision: 1,
          scenes: [{ id: "s1", order: 0, duration_ms: 3000, media_id: "m1" }]
        }
      }));
      return;
    }
    if (request.method === "DELETE" && getProject) {
      leftover.delete(getProject[1]);
      deleted.push(getProject[1]);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        project_id: getProject[1],
        deleted: true,
        storage_failures: []
      }));
      return;
    }
    const render = url.pathname.match(/^\/v1\/projects\/([^/]+)\/render$/);
    if (request.method === "POST" && render) {
      renderCount += 1;
      response.setHeader("content-type", "application/json");
      if (renderCount > quotaAfter) {
        response.statusCode = 402;
        response.end(JSON.stringify({ type: "quota_exceeded", message: "host usage quota exceeded" }));
        return;
      }
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const kind = JSON.parse(body || "{}").kind || "preview";
        response.end(JSON.stringify({
          job_id: `job-${render[1]}`,
          project_id: render[1],
          revision: 1,
          kind,
          state: "queued"
        }));
      });
      return;
    }
    const events = url.pathname.match(/^\/v1\/render-jobs\/([^/]+)\/events$/);
    if (events) {
      response.setHeader("content-type", "text/event-stream");
      response.end(`data: {"job_id":"${events[1]}","phase":"complete","percent":100}\n\n`);
      return;
    }
    const download = url.pathname.match(/^\/v1\/render-jobs\/([^/]+)\/download$/);
    if (download) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        url: `http://127.0.0.1:${server.address().port}/files/${download[1]}.mp4`,
        expires_at: "2099-01-01T00:00:00.000Z",
        kind: "final"
      }));
      return;
    }
    if (url.pathname.startsWith("/files/")) {
      response.setHeader("content-type", "video/mp4");
      response.end(Buffer.from(`mp4-${url.pathname}`));
      return;
    }
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end("{}");
  });
  return { server, hits, deleted, leftover };
}

test("batchReels loops composeReel, writes two files, and purges each project", async () => {
  const fake = composeFake();
  const origin = await listen(fake.server);
  const outDir = await mkdtemp(join(tmpdir(), "fmotion-batch-"));
  try {
    const result = await batchReels(new FmotionClient({
      apiOrigin: origin,
      apiKey: `fm_${"c".repeat(64)}`
    }), [
      { purpose: "Harbor dawn" },
      { purpose: "Workshop recap" }
    ], { render: "final", outDir });
    assert.equal(result.ok, true);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 0);
    assert.equal(result.render, "final");
    const files = (await readdir(outDir)).sort();
    assert.deepEqual(files, ["01-harbor-dawn.mp4", "02-workshop-recap.mp4"]);
    assert.match(await readFile(join(outDir, files[0]), "utf8"), /mp4-/);
    assert.deepEqual(fake.deleted, ["p1", "p2"]);
    assert.equal(fake.leftover.size, 0);
    assert.ok(fake.hits.every((hit) => !hit.includes("/batch")));
    assert.ok(fake.hits.filter((hit) => hit === "POST /v1/projects").length === 2);
  } finally {
    await new Promise((resolve, reject) => fake.server.close((error) => error ? reject(error) : resolve()));
  }
});

test("quota on a later item keeps prior files and already-purged projects", async () => {
  const fake = composeFake({ quotaAfter: 2 });
  const origin = await listen(fake.server);
  const outDir = await mkdtemp(join(tmpdir(), "fmotion-batch-quota-"));
  try {
    const result = await batchReels(new FmotionClient({
      apiOrigin: origin,
      apiKey: `fm_${"d".repeat(64)}`
    }), [
      { purpose: "One" },
      { purpose: "Two" },
      { purpose: "Three" }
    ], { render: "final", outDir });
    assert.equal(result.ok, false);
    assert.equal(result.succeeded, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.items[2].quota_exceeded, true);
    assert.equal(result.items[2].purged, true);
    const files = (await readdir(outDir)).sort();
    assert.deepEqual(files, ["01-one.mp4", "02-two.mp4"]);
    assert.deepEqual(fake.deleted, ["p1", "p2", "p3"]);
    assert.equal(fake.leftover.size, 0);
  } finally {
    await new Promise((resolve, reject) => fake.server.close((error) => error ? reject(error) : resolve()));
  }
});

test("loadBatchManifest resolves media paths relative to the manifest file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-manifest-"));
  await writeFile(join(directory, "manifest.json"), JSON.stringify([
    { purpose: "Relative media", mediaPaths: ["clip.jpg"] }
  ]));
  const items = await loadBatchManifest(directory);
  assert.equal(items.length, 1);
  assert.equal(items[0].mediaPaths[0], join(directory, "clip.jpg"));
});
