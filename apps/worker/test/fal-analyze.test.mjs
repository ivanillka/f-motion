import test from "node:test";
import assert from "node:assert/strict";
import { processFalAnalyzeJob } from "../dist/fal-analyze.js";

const env = {
  FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 7).toString("base64")
};

function baseRow(overrides = {}) {
  return {
    id: "job-a1",
    ownerId: "owner",
    projectId: "project",
    sceneId: "scene",
    credentialId: "cred-1",
    sourceMediaId: "media-1",
    endpointId: "fal-ai/moondream3-preview/query",
    inputJson: {
      source_media_id: "media-1",
      sealed_sha256: "a".repeat(64),
      declared_type: "image/jpeg",
      bytes: 12_000
    },
    state: "queued",
    cancelRequested: false,
    providerRequestId: null,
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
  const sourceSha = options.sourceSha ?? row.inputJson.sealed_sha256;
  return {
    queries,
    get row() { return row; },
    async connect() {
      return { async query(sql, params) { return query(sql, params); }, release() {} };
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
    if (sql.includes("FROM \"MediaAsset\"")) {
      return {
        rows: [{
          sealedObjectKey: "projects/project/media-sealed/still",
          sealedSha256: sourceSha,
          sealedEtag: "etag",
          state: "ready"
        }]
      };
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
    if (sql.includes("SET state = 'ready'")) {
      row.state = "ready";
      if (params[0]) row.inputJson = JSON.parse(params[0]);
      return { rowCount: 1 };
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 120)}`);
  }
}

const unusedStore = {
  async put() {}, async delete() {}, async signedGet() { throw new Error("no"); },
  async inspect() { throw new Error("no"); }, async seal() { throw new Error("no"); },
  async downloadSealed() { throw new Error("no"); }
};

test("analyze submitting without providerRequestId never resubmits", async () => {
  const pool = fakePool(baseRow({ state: "submitting", providerRequestId: null }));
  let posts = 0;
  const result = await processFalAnalyzeJob(
    pool,
    unusedStore,
    { generationJobId: "job-a1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    async () => { posts += 1; return new Response("{}", { status: 200 }); }
  );
  assert.equal(result.state, "submission_uncertain");
  assert.equal(posts, 0);
});

test("analyze writes story copy from FAL output without storing media", async () => {
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
  }));
  let signed = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (method === "POST" && String(url).includes("moondream3-preview/query")) {
      return new Response(JSON.stringify({ request_id: "req-a1" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/status")) {
      return new Response(JSON.stringify({ status: "COMPLETED" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/requests/") && method === "GET") {
      return new Response(JSON.stringify({
        output: '{"visual_prompt":"A red kayak on still water at dusk","caption":"Hold the last light"}'
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  const result = await processFalAnalyzeJob(
    pool,
    {
      ...unusedStore,
      async signedGet() {
        signed += 1;
        return "https://example.invalid/still.jpg";
      }
    },
    { generationJobId: "job-a1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(result.state, "ready");
  assert.equal(signed, 1);
  assert.equal(pool.row.state, "ready");
  assert.equal(pool.row.inputJson.analysis.caption, "Hold the last light");
  assert.equal(pool.row.inputJson.analysis.visual_prompt, "A red kayak on still water at dusk");
});
