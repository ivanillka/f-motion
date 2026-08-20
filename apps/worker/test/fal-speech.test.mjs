import test from "node:test";
import assert from "node:assert/strict";
import { processFalSpeechJob } from "../dist/fal-speech.js";

const env = {
  FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 7).toString("base64")
};

function wavBytes() {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  return buf;
}

function baseRow(overrides = {}) {
  return {
    id: "job-s1",
    ownerId: "owner",
    projectId: "project",
    sceneId: "scene",
    credentialId: "cred-1",
    prompt: "Hello from the storyboard.",
    inputJson: { prompt: "Hello from the storyboard.", voice: "am_adam", speed: 1 },
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
      const literal = sql.match(/"failureCode" = '([^']+)'/);
      row.failureCode = literal ? literal[1] : params[0];
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'downloading'")) {
      if (row.state === "running") row.state = "downloading";
      return { rowCount: 1 };
    }
    if (sql.includes("SET state = 'ready'")) {
      row.state = "ready";
      row.resultMediaId = params[0];
      return { rowCount: 1 };
    }
    if (sql.includes("INSERT INTO \"MediaAsset\"")) {
      options.insertedMedia = params;
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
  const result = await processFalSpeechJob(
    pool,
    { async put() { return { etag: "etag" }; }, async delete() {} },
    { generationJobId: "job-s1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(result.state, "submission_uncertain");
  assert.equal(pool.row.state, "submission_uncertain");
  assert.equal(submits, 0);
});

test("queued speech submits once, seals wav, skips inspect-media", async () => {
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
  const wav = wavBytes();
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (method === "POST" && String(url).includes("queue.fal.run") && !String(url).includes("/requests/")) {
      posts += 1;
      assert.match(String(url), /kokoro\/american-english/);
      assert.equal(JSON.parse(String(init.body)).voice, "am_adam");
      return new Response(JSON.stringify({ request_id: "req-speech" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/status")) {
      phase += 1;
      return new Response(JSON.stringify({ status: phase < 2 ? "IN_PROGRESS" : "COMPLETED" }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/requests/") && method === "GET" && !String(url).includes("/status")) {
      return new Response(JSON.stringify({
        audio: { url: "https://v3.fal.media/files/voice.wav" }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).startsWith("https://") && String(url).includes("fal.media")) {
      return new Response(wav, {
        status: 200,
        headers: { "content-type": "audio/wav", "content-length": String(wav.length) }
      });
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
  const puts = [];
  const result = await processFalSpeechJob(
    pool,
    {
      async put(key, _body, contentType, length) {
        puts.push({ key, contentType, length });
        return { etag: "\"etag\"" };
      },
      async delete() {}
    },
    { generationJobId: "job-s1", ownerId: "owner", projectId: "project" },
    new AbortController().signal,
    env,
    fetchImpl
  );
  assert.equal(posts, 1);
  assert.equal(result.state, "ready");
  assert.equal(pool.row.state, "ready");
  assert.equal(puts.length, 1);
  assert.match(puts[0].key, /media-sealed/);
  assert.equal(puts[0].contentType, "audio/wav");
  assert.equal(options.insertedMedia[8], "audio/wav");
  assert.equal(options.outbox, undefined);
  assert.equal(pool.queries.some(({ sql }) => sql.includes("inspect-media")), false);
});
