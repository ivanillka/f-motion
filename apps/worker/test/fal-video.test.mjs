import test from "node:test";
import assert from "node:assert/strict";
import { processFalVideoJob } from "../dist/fal-video.js";

const env = {
  FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 7).toString("base64")
};

function baseRow(overrides = {}) {
  return {
    id: "job-v1",
    ownerId: "owner",
    projectId: "project",
    sceneId: "scene",
    credentialId: "cred-1",
    sourceMediaId: "source-1",
    prompt: "slow pan right",
    inputJson: {
      source_media_id: "source-1",
      sealed_sha256: "a".repeat(64),
      declared_type: "image/jpeg",
      width: 720,
      height: 1280,
      bytes: 1200,
      duration: "6",
      motion_prompt: "slow pan right"
    },
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
  return {
    get row() { return row; },
    async connect() {
      return { async query(sql, params) { return query(sql, params); }, release() {} };
    },
    async query(sql, params = []) { return query(sql, params); }
  };

  async function query(sql, params = []) {
    if (sql.includes("FROM \"GenerationJob\"") && sql.includes("JOIN \"ProviderCredential\"")) {
      return { rows: row ? [structuredClone(row)] : [] };
    }
    if (sql.includes("FROM \"MediaAsset\"")) {
      if (options.sourceMissing) return { rows: [] };
      if (options.sourceSha !== undefined && options.sourceSha !== row.inputJson.sealed_sha256) {
        return { rows: [{
          sealedObjectKey: "sealed",
          sealedSha256: options.sourceSha,
          sealedEtag: "etag",
          sealedVersionId: null,
          state: "ready"
        }] };
      }
      return { rows: [{
        sealedObjectKey: "projects/project/media-sealed/source-1",
        sealedSha256: row.inputJson.sealed_sha256,
        sealedEtag: "etag",
        sealedVersionId: null,
        state: "ready"
      }] };
    }
    if (sql.includes("SET state = 'submitting'")) {
      if (row?.state !== "queued") return { rowCount: 0, rows: [] };
      row.state = "submitting";
      return { rowCount: 1, rows: [{ id: row.id }] };
    }
    if (sql.includes("SET state = 'submission_uncertain'")) {
      row.state = "submission_uncertain";
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'failed'")) {
      row.state = "failed";
      const literal = sql.match(/"failureCode" = '([^']+)'/);
      row.failureCode = literal ? literal[1] : params[0];
      return { rowCount: 1 };
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
    if (sql.includes("SET state = 'downloading'")) {
      if (row.state === "running") row.state = "downloading";
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'inspecting'")) {
      row.state = "inspecting";
      row.resultMediaId = params[0];
      return { rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"MediaAsset\"") || sql.includes("INSERT INTO \"WorkOutbox\"")) {
      return { rowCount: 1 };
    }
    if (sql.includes("BEGIN") || sql.includes("COMMIT") || sql.includes("ROLLBACK")) return { rowCount: 0 };
    throw new Error(`unexpected sql: ${sql.slice(0, 120)}`);
  }
}

test("video submitting without providerRequestId never resubmits", async () => {
  const pool = fakePool(baseRow({ state: "submitting", providerRequestId: null }));
  let posts = 0;
  const result = await processFalVideoJob(
    pool,
    { async put() {}, async delete() {}, async signedGet() { throw new Error("no"); },
      async inspect() { throw new Error("no"); }, async seal() { throw new Error("no"); },
      async downloadSealed() { throw new Error("no"); } },
    { generationJobId: "job-v1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    async () => { posts += 1; return new Response("{}", { status: 200 }); }
  );
  assert.equal(result.state, "submission_uncertain");
  assert.equal(posts, 0);
});

test("source SHA mismatch fails without signing or submitting", async () => {
  const { credentialVaultFromEnv, encryptCredential } = await import("@f-engine/fal-host");
  const vault = credentialVaultFromEnv(env);
  const encrypted = encryptCredential("fal-test-key", {
    id: "cred-1", ownerId: "owner", provider: "fal"
  }, vault);
  const pool = fakePool(baseRow({
    ciphertext: Buffer.from(encrypted.ciphertext),
    nonce: Buffer.from(encrypted.nonce),
    authTag: Buffer.from(encrypted.authTag),
    keyVersion: encrypted.keyVersion
  }), { sourceSha: "b".repeat(64) });
  let signed = 0;
  let posts = 0;
  const result = await processFalVideoJob(
    pool,
    {
      async put() {}, async delete() {},
      async signedGet() { signed += 1; return "https://example.invalid/x"; },
      async inspect() { throw new Error("no"); }, async seal() { throw new Error("no"); },
      async downloadSealed() { throw new Error("no"); }
    },
    { generationJobId: "job-v1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    async () => { posts += 1; return new Response("{}", { status: 200 }); }
  );
  assert.equal(result.state, "failed");
  assert.equal(pool.row.failureCode, "source_changed");
  assert.equal(signed, 0);
  assert.equal(posts, 0);
});

test("video poll ceiling without COMPLETED fails with poll_timeout and never downloads", async () => {
  const { credentialVaultFromEnv, encryptCredential } = await import("@f-engine/fal-host");
  const vault = credentialVaultFromEnv(env);
  const encrypted = encryptCredential("fal-test-key", {
    id: "cred-1", ownerId: "owner", provider: "fal"
  }, vault);
  const pool = fakePool(baseRow({
    state: "running",
    providerRequestId: "req-stuck",
    ciphertext: Buffer.from(encrypted.ciphertext),
    nonce: Buffer.from(encrypted.nonce),
    authTag: Buffer.from(encrypted.authTag),
    keyVersion: encrypted.keyVersion
  }));
  let statusGets = 0;
  let resultGets = 0;
  let downloads = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (String(url).includes("/status")) {
      statusGets += 1;
      return new Response(JSON.stringify({ status: "IN_PROGRESS" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/requests/") && method === "GET" && !String(url).includes("/status")) {
      resultGets += 1;
      return new Response(JSON.stringify({ video: { url: "https://v3b.fal.media/files/x.mp4" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("fal.media")) {
      downloads += 1;
      return new Response(Buffer.from("x"), { status: 200, headers: { "content-type": "video/mp4" } });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  const result = await processFalVideoJob(
    pool,
    {
      async put() {}, async delete() {}, async signedGet() { throw new Error("no"); },
      async inspect() { throw new Error("no"); }, async seal() { throw new Error("no"); },
      async downloadSealed() { throw new Error("no"); }
    },
    { generationJobId: "job-v1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl,
    0
  );
  assert.equal(result.state, "failed");
  assert.equal(pool.row.state, "failed");
  assert.equal(pool.row.failureCode, "poll_timeout");
  assert.equal(statusGets, 0);
  assert.equal(resultGets, 0);
  assert.equal(downloads, 0);
});

test("video retry at inspecting with resultMediaId is a no-op", async () => {
  const pool = fakePool(baseRow({
    state: "inspecting",
    providerRequestId: "req-1",
    resultMediaId: "media-1"
  }));
  let fetches = 0;
  const result = await processFalVideoJob(
    pool,
    {
      async put() { throw new Error("no put"); }, async delete() {},
      async signedGet() { throw new Error("no"); },
      async inspect() { throw new Error("no"); }, async seal() { throw new Error("no"); },
      async downloadSealed() { throw new Error("no"); }
    },
    { generationJobId: "job-v1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    async () => {
      fetches += 1;
      return new Response("{}", { status: 200 });
    }
  );
  assert.equal(result.state, "inspecting");
  assert.equal(fetches, 0);
  assert.equal(pool.row.state, "inspecting");
});
