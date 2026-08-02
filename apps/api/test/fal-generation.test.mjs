import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createTestApp } from "../dist/server.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  }));
}

test("FAL image quote/confirm/get/cancel routes are owner-scoped and body-exact", async () => {
  const jobs = new Map();
  const service = {
    async quoteImage(ownerId, projectId, sceneId, prompt) {
      assert.equal(ownerId, "authenticated-user");
      assert.equal(prompt, "quiet lighthouse");
      const job = {
        id: "job-1",
        project_id: projectId,
        scene_id: sceneId,
        kind: "image",
        endpoint_id: "fal-ai/flux/schnell",
        state: "quoted",
        cancel_requested: false,
        prompt,
        quote: {
          endpoint_id: "fal-ai/flux/schnell",
          unit_price: 0.02,
          unit: "image",
          currency: "USD",
          estimated_total: 0.02
        },
        quote_expires_at: new Date(Date.now() + 60_000).toISOString()
      };
      jobs.set(job.id, job);
      return job;
    },
    async confirm(ownerId, jobId, key) {
      assert.match(key, /^[0-9a-f-]{36}$/i);
      const job = { ...jobs.get(jobId), state: "queued" };
      jobs.set(jobId, job);
      return job;
    },
    async get(_ownerId, jobId) {
      return jobs.get(jobId);
    },
    async cancel(_ownerId, jobId) {
      const job = { ...jobs.get(jobId), state: "cancelled", cancel_requested: true };
      jobs.set(jobId, job);
      return job;
    }
  };
  const server = createServer(createTestApp({ falGeneration: service }));
  const origin = await listen(server);
  try {
    const quoted = await fetch(`${origin}/api/projects/p1/scenes/s1/fal/image-quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "quiet lighthouse" })
    });
    assert.equal(quoted.status, 201);
    const quoteBody = await quoted.json();
    assert.equal(quoteBody.state, "quoted");
    assert.equal("providerRequestId" in quoteBody, false);

    const bad = await fetch(`${origin}/api/projects/p1/scenes/s1/fal/image-quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x", model: "nope" })
    });
    assert.equal(bad.status, 422);

    const confirmed = await fetch(`${origin}/api/generation-jobs/job-1/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: "11111111-1111-4111-8111-111111111111" })
    });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).state, "queued");

    const got = await (await fetch(`${origin}/api/generation-jobs/job-1`)).json();
    assert.equal(got.state, "queued");

    const cancelled = await fetch(`${origin}/api/generation-jobs/job-1/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).state, "cancelled");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("FAL generation routes stay unavailable when the service is disabled", async () => {
  const server = createServer(createTestApp());
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/projects/p1/scenes/s1/fal/image-quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).type, "provider_unavailable");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
