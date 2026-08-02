import test from "node:test";
import assert from "node:assert/strict";
import { processFalImageJob } from "../dist/fal-image.js";

const env = {
  FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 7).toString("base64")
};

function baseRow(overrides = {}) {
  return {
    id: "job-1",
    ownerId: "owner",
    projectId: "project",
    sceneId: "scene",
    credentialId: "cred-1",
    prompt: "quiet lighthouse at dusk",
    state: "queued",
    cancelRequested: false,
    providerRequestId: null,
    resultMediaId: null,
    ciphertext: Buffer.alloc(16),
    nonce: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    keyVersion: 1,
    ...overrides
  };
}

function fakePool(initial, options = {}) {
  let row = structuredClone(initial);
  const queries = [];
  return {
    queries,
    get row() { return row; },
    async connect() {
      return {
        async query(sql, params) {
          return query(sql, params);
        },
        release() {}
      };
    },
    async query(sql, params = []) {
      return query(sql, params);
    }
  };

  async function query(sql, params = []) {
    queries.push({ sql, params });
    if (sql.includes("FROM \"GenerationJob\"") && sql.includes("JOIN \"ProviderCredential\"")) {
      return { rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.includes("SET state = 'submitting'")) {
      if (row?.state !== "queued") return { rowCount: 0, rows: [] };
      row.state = "submitting";
      return { rowCount: 1, rows: [{ id: row.id }] };
    }
    if (sql.includes("SET state = 'submission_uncertain'")) {
      if (row?.state === "submitting" && !row.providerRequestId) {
        row.state = "submission_uncertain";
        row.failureCode = "submission_uncertain";
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }
    if (sql.includes("SET \"providerRequestId\"")) {
      row.providerRequestId = params[0];
      row.state = "running";
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'cancelled'")) {
      row.state = "cancelled";
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'failed'")) {
      row.state = "failed";
      row.failureCode = params[0];
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'downloading'")) {
      if (row.state === "running") row.state = "downloading";
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'inspecting'")) {
      row.state = "inspecting";
      row.resultMediaId = params[0];
      return { rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"MediaAsset\"")) {
      options.insertedMedia = true;
      return { rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"WorkOutbox\"")) {
      options.outbox = params;
      return { rowCount: 1 };
    }
    if (sql.includes("BEGIN") || sql.includes("COMMIT") || sql.includes("ROLLBACK")) {
      return { rowCount: 0 };
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 120)}`);
  }
}

test("submitting without providerRequestId becomes submission_uncertain and never submits", async () => {
  const pool = fakePool(baseRow({ state: "submitting", providerRequestId: null }));
  let submits = 0;
  const fetchImpl = async () => {
    submits += 1;
    return new Response("{}", { status: 200 });
  };
  const result = await processFalImageJob(
    pool,
    { async put() {}, async delete() {} },
    { generationJobId: "job-1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(result.state, "submission_uncertain");
  assert.equal(pool.row.state, "submission_uncertain");
  assert.equal(submits, 0);
});

test("retry with persisted providerRequestId resumes polling and never resubmits", async () => {
  const { credentialVaultFromEnv, encryptCredential } = await import("@f-engine/fal-host");
  const vault = credentialVaultFromEnv(env);
  const encrypted = encryptCredential("fal-test-key", {
    id: "cred-1",
    ownerId: "owner",
    provider: "fal"
  }, vault);
  const pool = fakePool(baseRow({
    state: "running",
    providerRequestId: "req-1",
    ciphertext: Buffer.from(encrypted.ciphertext),
    nonce: Buffer.from(encrypted.nonce),
    authTag: Buffer.from(encrypted.authTag),
    keyVersion: encrypted.keyVersion
  }));
  let posts = 0;
  let statusGets = 0;
  const fetchImpl = async (_url, init = {}) => {
    if (String(init.method || "GET").toUpperCase() === "POST") {
      posts += 1;
      return new Response(JSON.stringify({ request_id: "x" }), { status: 200 });
    }
    statusGets += 1;
    return new Response(JSON.stringify({ status: "FAILED" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await processFalImageJob(
    pool,
    { async put() {}, async delete() {} },
    { generationJobId: "job-1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(result.state, "failed");
  assert.equal(posts, 0);
  assert.ok(statusGets >= 1);
});

test("queued job submits exactly once then polls to completion download path", async () => {
  const { credentialVaultFromEnv, encryptCredential } = await import("@f-engine/fal-host");
  const vault = credentialVaultFromEnv(env);
  const encrypted = encryptCredential("fal-test-key", {
    id: "cred-1",
    ownerId: "owner",
    provider: "fal"
  }, vault);
  const options = {};
  const pool = fakePool(baseRow({
    ciphertext: Buffer.from(encrypted.ciphertext),
    nonce: Buffer.from(encrypted.nonce),
    authTag: Buffer.from(encrypted.authTag),
    keyVersion: encrypted.keyVersion
  }), options);
  let posts = 0;
  let phase = 0;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (method === "POST" && String(url).includes("queue.fal.run") && !String(url).includes("/requests/")) {
      posts += 1;
      return new Response(JSON.stringify({ request_id: "req-once" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/status")) {
      phase += 1;
      return new Response(JSON.stringify({ status: phase < 2 ? "IN_PROGRESS" : "COMPLETED" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/requests/") && method === "GET" && !String(url).includes("/status")) {
      return new Response(JSON.stringify({
        images: [{ url: "https://v3.fal.media/files/still.png", content_type: "image/png" }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).startsWith("https://") && String(url).includes("fal.media")) {
      return new Response(png, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(png.length) }
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  const puts = [];
  const result = await processFalImageJob(
    pool,
    {
      async put(key, _body, contentType, length) {
        puts.push({ key, contentType, length });
      },
      async delete() {}
    },
    { generationJobId: "job-1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(posts, 1);
  assert.equal(result.state, "inspecting");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].contentType, "image/png");
  assert.equal(options.insertedMedia, true);
});

test("recovering after claim-before-submit never posts a second submit", async () => {
  // First crash window: handler sees submitting without ID.
  const pool = fakePool(baseRow({ state: "submitting", providerRequestId: null }));
  let posts = 0;
  const fetchImpl = async (_url, init = {}) => {
    if (String(init.method || "GET").toUpperCase() === "POST") posts += 1;
    return new Response("{}", { status: 200 });
  };
  await processFalImageJob(
    pool,
    { async put() {}, async delete() {} },
    { generationJobId: "job-1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(posts, 0);
  assert.equal(pool.row.state, "submission_uncertain");
  // Second recovery must stay terminal.
  const again = await processFalImageJob(
    pool,
    { async put() {}, async delete() {} },
    { generationJobId: "job-1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(again.state, "submission_uncertain");
  assert.equal(posts, 0);
});

