import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { credentialVaultFromEnv } from "@f-engine/fal-host";
import {
  PexelsProviderError,
  PostgresPexelsCredentialService,
  pexelsByokEnabled,
  validatePexelsCredential
} from "../dist/pexels-credentials.js";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function pexelsFetch(status = 200) {
  return async (_url, init) => {
    if (status !== 200) return new Response("upstream detail must not escape", { status });
    assert.equal(init.headers.authorization, "synthetic-pexels-key-1234");
    return new Response(JSON.stringify({ videos: [] }), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
}

function fakePool() {
  const rows = new Map();
  const query = async (sql, params = []) => {
    if (sql.startsWith(`SELECT id, "ownerId"`)) {
      const row = rows.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith(`UPDATE "ProviderCredential"`)) {
      const row = rows.get(params[2]);
      if (row && row.id === params[1]) row.validatedAt = params[0];
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith(`DELETE FROM "ProviderCredential"`)) {
      rows.delete(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.startsWith(`SELECT id FROM "User"`)) return { rows: [{ id: params[0] }], rowCount: 1 };
    if (sql.startsWith(`SELECT id FROM "ProviderCredential"`)) {
      const row = rows.get(params[0]);
      return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith(`INSERT INTO "ProviderCredential"`)) {
      const [id, ownerId, ciphertext, nonce, authTag, keyVersion, hint, validatedAt] = params;
      rows.set(ownerId, {
        id, ownerId, provider: "pexels", ciphertext: Buffer.from(ciphertext), nonce: Buffer.from(nonce),
        authTag: Buffer.from(authTag), keyVersion, hint, validatedAt
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected fake query: ${sql}`);
  };
  return { query, connect: async () => ({ query, release() {} }), rows };
}

test("Pexels BYOK configuration and validation fail closed", async () => {
  assert.equal(pexelsByokEnabled({}), false);
  assert.equal(pexelsByokEnabled({ FENGINE_PEXELS_BYOK_ENABLED: "1" }), true);
  assert.throws(() => pexelsByokEnabled({ FENGINE_PEXELS_BYOK_ENABLED: "yes" }));
  await validatePexelsCredential("synthetic-pexels-key-1234", pexelsFetch());
  for (const status of [401, 403]) {
    await assert.rejects(
      validatePexelsCredential("synthetic", pexelsFetch(status)),
      (error) => error instanceof PexelsProviderError && error.code === "credential"
    );
  }
  for (const response of [
    new Response("busy", { status: 429 }),
    new Response("broken", { status: 500 }),
    new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ videos: [] }), { status: 200, headers: { "content-type": "text/plain" } }),
    new Response(JSON.stringify({ photos: [] }), { status: 200, headers: { "content-type": "application/json" } })
  ]) {
    await assert.rejects(
      validatePexelsCredential("synthetic", async () => response),
      (error) => error instanceof PexelsProviderError && error.code === "unavailable"
    );
  }
});

test("Pexels credential is encrypted, owner-scoped, and never projected", async () => {
  const pool = fakePool();
  const vault = credentialVaultFromEnv({
    FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 8).toString("base64")
  });
  const service = new PostgresPexelsCredentialService(pool, vault, pexelsFetch());
  const connected = await service.connect("owner", "synthetic-pexels-key-1234");
  assert.deepEqual(connected, {
    provider: "pexels", connected: true, hint: "1234", validated_at: connected.validated_at
  });
  assert.equal(JSON.stringify(connected).includes("synthetic"), false);
  assert.equal(pool.rows.get("owner").ciphertext.toString("utf8").includes("synthetic"), false);
  assert.deepEqual(await service.status("other"), { provider: "pexels", connected: false });
  assert.equal((await service.test("owner")).connected, true);
  await service.client("owner").then((client) => client.search("cinematic"));
  await assert.rejects(service.client("other"));
  await service.disconnect("other");
  assert.equal((await service.status("owner")).connected, true);
});

test("Pexels credential lifecycle routes are exact, redacted, and owner-scoped", async () => {
  const calls = [];
  let saved = false;
  const service = {
    async status(ownerId) { calls.push(["status", ownerId]); return { provider: "pexels", connected: saved }; },
    async connect(ownerId, key) {
      calls.push(["connect", ownerId]);
      assert.equal(key, "synthetic-pexels-key-1234");
      saved = true;
      return { provider: "pexels", connected: true, hint: "1234" };
    },
    async test(ownerId) { calls.push(["test", ownerId]); return { provider: "pexels", connected: true, hint: "1234" }; },
    async disconnect(ownerId) { calls.push(["disconnect", ownerId]); saved = false; },
    async client() { throw new Error("unused"); }
  };
  const server = createServer(createTestApp({ ownerId: "route-owner", pexelsCredentials: service }));
  const origin = await listen(server);
  try {
    assert.deepEqual(await (await fetch(`${origin}/api/providers/pexels/credential`)).json(), { provider: "pexels", connected: false });
    const bad = await fetch(`${origin}/api/providers/pexels/credential`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: "synthetic-pexels-key-1234", extra: true })
    });
    assert.equal(bad.status, 422);
    const connected = await fetch(`${origin}/api/providers/pexels/credential`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: "synthetic-pexels-key-1234" })
    });
    assert.equal(connected.status, 200);
    assert.equal((await connected.text()).includes("synthetic"), false);
    assert.equal((await fetch(`${origin}/api/providers/pexels/credential/test`, { method: "POST" })).status, 200);
    assert.equal((await fetch(`${origin}/api/providers/pexels/credential`, { method: "DELETE" })).status, 204);
    assert.ok(calls.every(([, ownerId]) => ownerId === "route-owner"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Pexels still search uses the photos API and drops download URLs", async () => {
  const owners = [];
  const server = createServer(createTestApp({
    ownerId: "media-owner",
    media: {
      repository: {}, store: {},
      pexelsForOwner: async (ownerId) => {
        owners.push(ownerId);
        return {
          async searchStills() {
            return [{
              id: 7,
              creator: "Ada",
              attributionUrl: "https://www.pexels.com/photo/7/",
              previewUrl: "https://images.pexels.com/7.jpg",
              sourceUrl: "https://images.pexels.com/7-orig.jpg",
              contentType: "image/jpeg"
            }];
          }
        };
      }
    }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/pexels/photos/search?q=ocean`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      results: [{
        id: 7,
        creator: "Ada",
        attributionUrl: "https://www.pexels.com/photo/7/",
        previewUrl: "https://images.pexels.com/7.jpg",
        source: "pexels",
        kind: "still"
      }]
    });
    assert.deepEqual(owners, ["media-owner"]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Pexels media search resolves only the authenticated owner's client", async () => {
  const owners = [];
  const server = createServer(createTestApp({
    ownerId: "media-owner",
    media: {
      repository: {}, store: {},
      pexelsForOwner: async (ownerId) => {
        owners.push(ownerId);
        return { async search() { return []; } };
      }
    }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/pexels/search?q=ocean`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [] });
    assert.deepEqual(owners, ["media-owner"]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
