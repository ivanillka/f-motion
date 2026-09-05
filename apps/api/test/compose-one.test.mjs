import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import { composeOne, runBatch } from "../dist/compose-one.js";
import { createTestApp } from "../dist/server.js";

test("composeOne creates a storyboard through the project repository", async () => {
  const projects = new ProjectService();
  const result = await composeOne({ projects }, "owner", {
    purpose: "Harbor dawn for customers",
    render: "none"
  });
  assert.equal(result.next, "draft_only");
  assert.ok(result.scene_count >= 4);
  const stored = projects.get("owner", result.project_id);
  assert.equal(stored?.scenes.length, result.scene_count);
});

test("runBatch loops composeOne, then purges each project", async () => {
  const projects = new ProjectService();
  const composed = [];
  const purged = [];
  const result = await runBatch({
    projects,
    async fillStock(ownerId, projectId) {
      composed.push(projectId);
      const project = await projects.get(ownerId, projectId);
      const scene = project.scenes[0];
      await projects.command(ownerId, {
        command_id: crypto.randomUUID(),
        project_id: projectId,
        base_revision: project.revision,
        client_timestamp: new Date().toISOString(),
        kind: "update_scene",
        payload: { scene: { ...scene, media_id: "ready-1" } }
      });
      for (const extra of project.scenes.slice(1)) {
        const latest = await projects.get(ownerId, projectId);
        await projects.command(ownerId, {
          command_id: crypto.randomUUID(),
          project_id: projectId,
          base_revision: latest.revision,
          client_timestamp: new Date().toISOString(),
          kind: "update_scene",
          payload: { scene: { ...latest.scenes.find((item) => item.id === extra.id), media_id: "ready-1" } }
        });
      }
    },
    async requestRender(_owner, projectId) {
      return { job_id: `job-${projectId}`, kind: "final" };
    },
    async waitRender() {
      return { phase: "complete" };
    },
    async download(_owner, jobId) {
      return { url: `https://download.example/${jobId}.mp4`, expires_at: "2099-01-01T00:00:00.000Z", kind: "final" };
    },
    async purge(_owner, projectId) {
      purged.push(projectId);
      projects.delete("owner", projectId);
      return { project_id: projectId, deleted: true, storage_failures: [] };
    }
  }, "owner", [
    { purpose: "First reel", fillStock: true },
    { purpose: "Second reel", fillStock: true }
  ], { render: "final" });

  assert.equal(result.ok, true);
  assert.equal(result.succeeded, 2);
  assert.equal(composed.length, 2);
  assert.deepEqual(purged, composed);
  assert.equal(projects.list("owner").length, 0);
  assert.equal(result.items[0].download.url.includes(result.items[0].job_id), true);
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  return `http://127.0.0.1:${address.port}`;
}

test("POST /v1/batches is registered and loops composeOne", async () => {
  const server = createServer(createTestApp({ ownerId: "owner", projects: new ProjectService() }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/v1/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        render: "final",
        items: [{ purpose: "One" }, { purpose: "Two" }]
      })
    });
    assert.ok(response.headers.get("content-type")?.includes("json"));
    const body = await response.json();
    assert.equal(body.render, "final");
    assert.equal(body.items.length, 2);
    assert.equal(body.failed, 2);
    assert.match(body.items[0].error, /no ready media|needs media/i);
    const listed = await fetch(`${origin}/v1/projects`);
    assert.deepEqual((await listed.json()).projects, []);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
