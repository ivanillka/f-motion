import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { FalCredentialMissingError } from "../dist/fal-credentials.js";
import {
  FalGenerationBusyError,
  PostgresFalGenerationService,
  falGenerationHttpError
} from "../dist/fal-generation.js";
import { createTestApp } from "../dist/server.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  }));
}

const ACTIVE_STATES = ["queued", "submitting", "running", "downloading", "inspecting"];

function baseJob(overrides = {}) {
  return {
    id: "job-1",
    ownerId: "owner",
    projectId: "project",
    sceneId: "scene",
    kind: "image",
    endpointId: "fal-ai/flux/schnell",
    prompt: "quiet lighthouse",
    inputJson: { prompt: "quiet lighthouse" },
    quoteJson: {
      endpoint_id: "fal-ai/flux/schnell",
      unit_price: 0.02,
      unit: "image",
      currency: "USD",
      estimated_total: 0.02
    },
    quoteExpiresAt: new Date(Date.now() + 60_000),
    state: "queued",
    cancelRequested: false,
    failureCode: null,
    resultMediaId: null,
    sourceMediaId: null,
    providerRequestId: null,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    ...overrides
  };
}

function generationFakePool(initialJobs) {
  const jobs = new Map(initialJobs.map((job) => [job.id, structuredClone(job)]));

  function isActive(job) {
    return ACTIVE_STATES.includes(job.state)
      || (job.cancelRequested && !["ready", "cancelled", "failed", "submission_uncertain"].includes(job.state));
  }

  async function query(sql, params = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.includes("COUNT(*)") && sql.includes("FROM \"GenerationJob\"")) {
      const ownerId = params[0];
      const sceneId = sql.includes("\"sceneId\"") ? params[1] : undefined;
      let count = 0;
      for (const job of jobs.values()) {
        if (job.ownerId !== ownerId) continue;
        if (sceneId && job.sceneId !== sceneId) continue;
        if (isActive(job)) count += 1;
      }
      return { rows: [{ count }], rowCount: 1 };
    }
    if (sql.includes("FROM \"GenerationJob\"") && sql.includes("FOR UPDATE")) {
      const job = jobs.get(params[0]);
      if (!job || job.ownerId !== params[1]) return { rows: [], rowCount: 0 };
      return { rows: [structuredClone(job)], rowCount: 1 };
    }
    if (sql.includes("FROM \"GenerationJob\"") && sql.includes("WHERE id = $1 AND \"ownerId\" = $2")
      && !sql.includes("FOR UPDATE") && !sql.includes("COUNT")) {
      const job = jobs.get(params[0]);
      if (!job || job.ownerId !== params[1]) return { rows: [], rowCount: 0 };
      return { rows: [structuredClone(job)], rowCount: 1 };
    }
    if (sql.includes("SET \"cancelRequested\" = TRUE")) {
      const job = jobs.get(params[1]);
      if (!job || job.ownerId !== params[2]) return { rowCount: 0 };
      job.cancelRequested = true;
      job.state = params[0];
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'queued'") && sql.includes("\"idempotencyKey\"")) {
      const job = jobs.get(params[1]);
      if (!job || job.ownerId !== params[2] || job.state !== "quoted") return { rowCount: 0 };
      job.idempotencyKey = params[0];
      job.state = "queued";
      return { rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"WorkOutbox\"")) return { rowCount: 1 };
    if (sql.includes("FROM \"MediaAsset\"")) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected sql: ${sql.slice(0, 140)}`);
  }

  return {
    jobs,
    async query(sql, params = []) { return query(sql, params); },
    async connect() {
      return { async query(sql, params = []) { return query(sql, params); }, release() {} };
    }
  };
}

const stubCredentials = {
  async decryptForOwner() { return { id: "cred", apiKey: "key" }; },
  async status() { return { provider: "fal", connected: true }; },
  async connect() { throw new Error("unused"); },
  async test() { throw new Error("unused"); },
  async disconnect() { throw new Error("unused"); }
};

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

test("FAL video quote route is body-exact and owner-scoped", async () => {
  const service = {
    async quoteImage() { throw new Error("unused"); },
    async quoteVideo(ownerId, projectId, sceneId, sourceMediaId, prompt) {
      assert.equal(ownerId, "authenticated-user");
      assert.equal(sourceMediaId, "11111111-1111-4111-8111-111111111111");
      assert.equal(prompt, "slow pan");
      return {
        id: "vjob",
        project_id: projectId,
        scene_id: sceneId,
        kind: "image_to_video",
        endpoint_id: "fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video",
        state: "quoted",
        cancel_requested: false,
        prompt,
        quote: {
          endpoint_id: "fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video",
          unit_price: 0.19,
          unit: "video",
          currency: "USD",
          estimated_total: 0.19
        },
        quote_expires_at: new Date(Date.now() + 60_000).toISOString(),
        source_media_id: sourceMediaId
      };
    },
    async confirm() { throw new Error("unused"); },
    async get() { return undefined; },
    async cancel() { throw new Error("unused"); }
  };
  const server = createServer(createTestApp({ falGeneration: service }));
  const origin = await listen(server);
  try {
    const ok = await fetch(`${origin}/api/projects/p1/scenes/s1/fal/video-quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_media_id: "11111111-1111-4111-8111-111111111111",
        motion_prompt: "slow pan"
      })
    });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).kind, "image_to_video");
    const bad = await fetch(`${origin}/api/projects/p1/scenes/s1/fal/video-quotes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ motion_prompt: "x", endpoint: "nope" })
    });
    assert.equal(bad.status, 422);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("confirm after disconnect fails closed as fal_not_connected", async () => {
  const pool = generationFakePool([baseJob({ state: "quoted" })]);
  const disconnected = {
    ...stubCredentials,
    async decryptForOwner() { throw new FalCredentialMissingError("FAL is not connected"); }
  };
  const service = new PostgresFalGenerationService(pool, disconnected);
  await assert.rejects(
    () => service.confirm("owner", "job-1", "11111111-1111-4111-8111-111111111111"),
    FalCredentialMissingError
  );
  assert.equal(pool.jobs.get("job-1").state, "quoted");

  const mapped = falGenerationHttpError(new FalCredentialMissingError("FAL is not connected"));
  assert.equal(mapped?.status, 409);
  assert.equal(mapped?.body.type, "fal_not_connected");

  const server = createServer(createTestApp({
    falGeneration: {
      async quoteImage() { throw new Error("unused"); },
      async quoteVideo() { throw new Error("unused"); },
      async confirm() { throw new FalCredentialMissingError("FAL is not connected"); },
      async get() { return undefined; },
      async cancel() { throw new Error("unused"); }
    }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/generation-jobs/job-1/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: "11111111-1111-4111-8111-111111111111" })
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).type, "fal_not_connected");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("cancel queued frees the active slot", async () => {
  const pool = generationFakePool([baseJob({ state: "queued" })]);
  const service = new PostgresFalGenerationService(pool, stubCredentials);
  const cancelled = await service.cancel("owner", "job-1");
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.cancel_requested, true);
  assert.equal(pool.jobs.get("job-1").state, "cancelled");

  const quoted = baseJob({
    id: "job-2",
    state: "quoted",
    idempotencyKey: "22222222-2222-4222-8222-222222222222"
  });
  pool.jobs.set(quoted.id, quoted);
  const confirmed = await service.confirm(
    "owner",
    "job-2",
    "22222222-2222-4222-8222-222222222222"
  );
  assert.equal(confirmed.state, "queued");
});

test("cancel running with no providerRequestId cancels immediately", async () => {
  const pool = generationFakePool([baseJob({
    state: "running",
    providerRequestId: null
  })]);
  const service = new PostgresFalGenerationService(pool, stubCredentials);
  const cancelled = await service.cancel("owner", "job-1");
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.cancel_requested, true);

  const quoted = baseJob({
    id: "job-2",
    state: "quoted",
    idempotencyKey: "33333333-3333-4333-8333-333333333333"
  });
  pool.jobs.set(quoted.id, quoted);
  const confirmed = await service.confirm(
    "owner",
    "job-2",
    "33333333-3333-4333-8333-333333333333"
  );
  assert.equal(confirmed.state, "queued");
});

test("second cancel on stuck running with providerRequestId forces cancelled", async () => {
  const pool = generationFakePool([baseJob({
    state: "running",
    providerRequestId: "req-1",
    cancelRequested: false
  })]);
  const service = new PostgresFalGenerationService(pool, stubCredentials);

  const first = await service.cancel("owner", "job-1");
  assert.equal(first.state, "running");
  assert.equal(first.cancel_requested, true);

  const quoted = baseJob({
    id: "job-2",
    state: "quoted",
    idempotencyKey: "44444444-4444-4444-8444-444444444444"
  });
  pool.jobs.set(quoted.id, quoted);
  await assert.rejects(
    () => service.confirm("owner", "job-2", "44444444-4444-4444-8444-444444444444"),
    FalGenerationBusyError
  );

  const second = await service.cancel("owner", "job-1");
  assert.equal(second.state, "cancelled");
  assert.equal(second.cancel_requested, true);

  const confirmed = await service.confirm(
    "owner",
    "job-2",
    "44444444-4444-4444-8444-444444444444"
  );
  assert.equal(confirmed.state, "queued");
});
