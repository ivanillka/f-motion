import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { credentialVaultFromEnv, FalProviderError } from "@f-engine/fal-host";
import {
  FalCredentialBusyError,
  PostgresFalCredentialService
} from "../dist/fal-credentials.js";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function pricingFetch(status = 200) {
  return async (url) => {
    if (String(url).includes("/account/billing")) {
      return new Response(JSON.stringify({
        username: "studio",
        credits: { current_balance: 24.5, currency: "USD" }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return status === 200
      ? new Response(JSON.stringify({
          prices: [{ endpoint_id: "fal-ai/flux/schnell", unit_price: 0.003, unit: "megapixel", currency: "USD" }]
        }), { status, headers: { "content-type": "application/json" } })
      : new Response("upstream detail must not escape", { status });
  };
}

function fakePool({ activeGenerationCount = 0 } = {}) {
  const rows = new Map();
  const state = { activeGenerationCount };
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
        id, ownerId, provider: "fal", ciphertext: Buffer.from(ciphertext), nonce: Buffer.from(nonce),
        authTag: Buffer.from(authTag), keyVersion, hint, validatedAt
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes(`FROM "GenerationJob"`) && sql.includes("COUNT(*)")) {
      return { rows: [{ count: state.activeGenerationCount }], rowCount: 1 };
    }
    if (sql.startsWith(`UPDATE "GenerationJob"`)) return { rows: [], rowCount: 0 };
    throw new Error(`unexpected fake query: ${sql}`);
  };
  return { query, connect: async () => ({ query, release() {} }), rows, state };
}

test("Postgres service encrypts one credential per owner and never projects it", async () => {
  const pool = fakePool();
  const vault = credentialVaultFromEnv({
    FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 9).toString("base64")
  });
  const service = new PostgresFalCredentialService(pool, vault, pricingFetch());
  const connected = await service.connect("owner", "synthetic:key-1234");
  assert.equal(connected.connected, true);
  assert.equal(connected.hint, "1234");
  assert.equal(connected.account?.credits?.current_balance, 24.5);
  assert.equal(connected.account?.username, "studio");
  assert.equal(JSON.stringify(connected).includes("synthetic"), false);
  assert.equal(pool.rows.get("owner").ciphertext.toString("utf8").includes("synthetic"), false);
  assert.deepEqual(await service.status("other"), { provider: "fal", connected: false });
  assert.equal((await service.test("owner")).connected, true);
  assert.equal((await service.status("owner")).account?.credits?.current_balance, 24.5);
  await service.disconnect("other");
  assert.equal((await service.status("owner")).connected, true);
  await service.disconnect("owner");
  assert.equal((await service.status("owner")).connected, false);
});

test("credential routes are fail-closed, exact, owner-scoped, and redacted", async () => {
  const calls = [];
  let saved = false;
  const service = {
    async status(ownerId) { calls.push(["status", ownerId]); return { provider: "fal", connected: saved, ...(saved ? { hint: "1234", validated_at: new Date(0).toISOString() } : {}) }; },
    async connect(ownerId, key) { calls.push(["connect", ownerId]); saved = true; assert.equal(key, "synthetic:key-1234"); return { provider: "fal", connected: true, hint: "1234", validated_at: new Date(0).toISOString() }; },
    async test(ownerId) { calls.push(["test", ownerId]); return { provider: "fal", connected: true, hint: "1234", validated_at: new Date(0).toISOString() }; },
    async disconnect(ownerId) { calls.push(["disconnect", ownerId]); saved = false; },
    async decryptForOwner(ownerId) { calls.push(["decrypt", ownerId]); return { id: "cred", apiKey: "synthetic:key-1234" }; }
  };
  const server = createServer(createTestApp({ ownerId: "route-owner", falCredentials: service }));
  const origin = await listen(server);
  try {
    assert.deepEqual(await (await fetch(`${origin}/api/providers/fal/credential`)).json(), { provider: "fal", connected: false });
    const bad = await fetch(`${origin}/api/providers/fal/credential`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: "synthetic:key-1234", extra: true })
    });
    assert.equal(bad.status, 422);
    const connected = await fetch(`${origin}/api/providers/fal/credential`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: "synthetic:key-1234" })
    });
    assert.equal(connected.status, 200);
    assert.equal((await connected.text()).includes("synthetic"), false);
    assert.equal((await fetch(`${origin}/api/providers/fal/credential/test`, { method: "POST" })).status, 200);
    assert.equal((await fetch(`${origin}/api/providers/fal/credential`, { method: "DELETE" })).status, 204);
    assert.ok(calls.every(([, ownerId]) => ownerId === "route-owner"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const disabled = createServer(createTestApp());
  const disabledOrigin = await listen(disabled);
  try {
    const response = await fetch(`${disabledOrigin}/api/providers/fal/credential`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).type, "provider_unavailable");
  } finally {
    await new Promise((resolve, reject) => disabled.close((error) => error ? reject(error) : resolve()));
  }
});

test("disconnect succeeds with terminal generation history and stays busy for active jobs", async () => {
  const vault = credentialVaultFromEnv({
    FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 9).toString("base64")
  });
  const terminalPool = fakePool({ activeGenerationCount: 0 });
  const terminalService = new PostgresFalCredentialService(terminalPool, vault, pricingFetch());
  await terminalService.connect("owner", "synthetic:key-1234");
  // Terminal GenerationJob history does not increment activeGenerationCount.
  await terminalService.disconnect("owner");
  assert.deepEqual(await terminalService.status("owner"), { provider: "fal", connected: false });

  const activePool = fakePool({ activeGenerationCount: 1 });
  const activeService = new PostgresFalCredentialService(activePool, vault, pricingFetch());
  await assert.rejects(() => activeService.connect("owner", "synthetic:key-1234"), FalCredentialBusyError);
  activePool.state.activeGenerationCount = 0;
  await activeService.connect("owner", "synthetic:key-1234");
  activePool.state.activeGenerationCount = 1;
  await assert.rejects(() => activeService.disconnect("owner"), FalCredentialBusyError);
  assert.equal((await activeService.status("owner")).connected, true);

  const busyServer = createServer(createTestApp({
    falCredentials: {
      async status() { return { provider: "fal", connected: true, hint: "1234", validated_at: new Date(0).toISOString() }; },
      async connect() { throw new Error("unused"); },
      async test() { throw new Error("unused"); },
      async disconnect() { throw new FalCredentialBusyError("active FAL generation"); },
      async decryptForOwner() { throw new Error("unused"); }
    }
  }));
  const busyOrigin = await listen(busyServer);
  try {
    const response = await fetch(`${busyOrigin}/api/providers/fal/credential`, { method: "DELETE" });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).type, "fal_credential_busy");
  } finally {
    await new Promise((resolve, reject) => busyServer.close((error) => error ? reject(error) : resolve()));
  }

  const terminalServer = createServer(createTestApp({
    falCredentials: {
      async status() { return { provider: "fal", connected: false }; },
      async connect() { throw new Error("unused"); },
      async test() { throw new Error("unused"); },
      async disconnect() {},
      async decryptForOwner() { throw new Error("unused"); }
    }
  }));
  const terminalOrigin = await listen(terminalServer);
  try {
    assert.equal((await fetch(`${terminalOrigin}/api/providers/fal/credential`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await (await fetch(`${terminalOrigin}/api/providers/fal/credential`)).json(), {
      provider: "fal",
      connected: false
    });
  } finally {
    await new Promise((resolve, reject) => terminalServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("credential route maps provider failures without reflecting upstream data", async () => {
  for (const [error, status, type] of [
    [new FalProviderError("credential"), 422, "invalid_provider_credential"],
    [new FalProviderError("unavailable"), 503, "provider_unavailable"]
  ]) {
    const server = createServer(createTestApp({ falCredentials: {
      async status() { return { provider: "fal", connected: false }; },
      async connect() { throw error; },
      async test() { throw error; },
      async disconnect() {}, async decryptForOwner() { throw new Error("unused"); }
    } }));
    const origin = await listen(server);
    try {
      const response = await fetch(`${origin}/api/providers/fal/credential`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: "synthetic:key" })
      });
      assert.equal(response.status, status);
      const text = await response.text();
      assert.equal(JSON.parse(text).type, type);
      assert.equal(text.includes("synthetic"), false);
    } finally {
      await new Promise((resolve, reject) => server.close((closeError) => closeError ? reject(closeError) : resolve()));
    }
  }
});

test("connected status reports ADMIN billing and maps API-scope 403 without leaking upstream", async () => {
  const vault = credentialVaultFromEnv({
    FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 9).toString("base64")
  });
  const pool = fakePool();
  const scoped = new PostgresFalCredentialService(pool, vault, async (url) => {
    if (String(url).includes("/account/billing")) return new Response("admin only", { status: 403 });
    return new Response(JSON.stringify({
      prices: [{ endpoint_id: "fal-ai/flux/schnell", unit_price: 0.003, unit: "megapixel", currency: "USD" }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const connected = await scoped.connect("owner", "synthetic:key-1234");
  assert.equal(connected.account?.credits_unavailable, "admin_key_required");
  assert.equal(JSON.stringify(connected).includes("admin only"), false);
  const status = await scoped.status("owner");
  assert.equal(status.connected, true);
  assert.equal(status.account?.credits_unavailable, "admin_key_required");
});
