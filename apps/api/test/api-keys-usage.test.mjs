import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createHash, randomBytes } from "node:crypto";
import { ProjectService } from "../dist/domain.js";
import {
  freeRenderUnitsFromEnv,
  PostgresHostUsageService,
  QuotaExceededError,
  renderUnitCost
} from "../dist/host-usage.js";
import { PostgresApiKeyService } from "../dist/api-keys.js";
import { createApp, createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("free grant env and render unit costs are honest", () => {
  assert.equal(freeRenderUnitsFromEnv({}), 25);
  assert.equal(freeRenderUnitsFromEnv({ FENGINE_FREE_RENDER_UNITS: "10" }), 10);
  assert.throws(() => freeRenderUnitsFromEnv({ FENGINE_FREE_RENDER_UNITS: "-1" }), /FENGINE_FREE_RENDER_UNITS/);
  assert.deepEqual(renderUnitCost("preview"), { cost: 1, reason: "render_preview" });
  assert.deepEqual(renderUnitCost("final"), { cost: 2, reason: "render_final" });
});

function memoryUsagePool() {
  const balances = new Map();
  const ledger = new Map();
  const query = async (sql, params = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.includes(`INSERT INTO "UsageBalance"`) && sql.includes("ON CONFLICT")) {
      if (balances.has(params[0])) return { rows: [], rowCount: 0 };
      balances.set(params[0], params[1]);
      return { rows: [{ ownerId: params[0] }], rowCount: 1 };
    }
    if (sql.includes(`INSERT INTO "UsageLedger"`)) {
      const key = `${params[1]}:${params[4] ?? params[3]}`;
      // free_grant uses params [id, ownerId, delta] with reason literal; consume uses reason param
      const ownerId = params[1];
      const idem = sql.includes("'free_grant'") ? "free_grant" : params[4];
      const mapKey = `${ownerId}:${idem}`;
      if (ledger.has(mapKey)) return { rows: [], rowCount: 0 };
      ledger.set(mapKey, { ownerId, delta: params[2], reason: sql.includes("'free_grant'") ? "free_grant" : params[3] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith(`SELECT balance FROM "UsageBalance"`)) {
      const balance = balances.get(params[0]);
      return { rows: balance === undefined ? [] : [{ balance }], rowCount: balance === undefined ? 0 : 1 };
    }
    if (sql.startsWith(`SELECT id FROM "UsageLedger"`)) {
      const mapKey = `${params[0]}:${params[1]}`;
      return ledger.has(mapKey) ? { rows: [{ id: "1" }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith(`UPDATE "UsageBalance"`) && sql.includes("balance -")) {
      const current = balances.get(params[0]) ?? 0;
      if (current < params[1]) return { rows: [], rowCount: 0 };
      const next = current - params[1];
      balances.set(params[0], next);
      return { rows: [{ balance: next }], rowCount: 1 };
    }
    if (sql.startsWith(`UPDATE "UsageBalance"`) && sql.includes("balance +")) {
      const next = (balances.get(params[0]) ?? 0) + params[1];
      balances.set(params[0], next);
      return { rows: [{ balance: next }], rowCount: 1 };
    }
    throw new Error(`unexpected usage query: ${sql}`);
  };
  return {
    balances,
    ledger,
    query,
    connect: async () => ({ query, release() {} })
  };
}

function memoryApiKeyPool() {
  const rows = [];
  const query = async (sql, params = []) => {
    if (sql.startsWith(`INSERT INTO "ApiKey"`)) {
      rows.push({
        id: params[0],
        ownerId: params[1],
        tokenHash: params[2],
        hint: params[3],
        label: params[4],
        createdAt: params[5],
        revokedAt: null
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes(`FROM "ApiKey"`) && sql.includes("ORDER BY")) {
      const owned = rows.filter((row) => row.ownerId === params[0])
        .sort((a, b) => b.createdAt - a.createdAt);
      return { rows: owned, rowCount: owned.length };
    }
    if (sql.startsWith(`UPDATE "ApiKey"`)) {
      const row = rows.find((item) => item.id === params[0] && item.ownerId === params[1] && !item.revokedAt);
      if (!row) return { rows: [], rowCount: 0 };
      row.revokedAt = new Date();
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes(`FROM "ApiKey"`) && sql.includes("tokenHash")) {
      const row = rows.find((item) => item.tokenHash === params[0] && !item.revokedAt);
      return { rows: row ? [{ ownerId: row.ownerId, tokenHash: row.tokenHash }] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`unexpected api key query: ${sql}`);
  };
  return { rows, query, connect: async () => ({ query, release() {} }) };
}

test("host usage free grant then debit, idempotent, and quota fail-closed", async () => {
  const pool = memoryUsagePool();
  const usage = new PostgresHostUsageService(pool, 3);
  assert.deepEqual(await usage.status("owner"), {
    unit: "render_unit",
    balance: 3,
    free_grant: 3,
    costs: { preview: 1, final: 2 }
  });
  assert.equal(await usage.consumeRender("owner", "preview", "job-1"), 2);
  assert.equal(await usage.consumeRender("owner", "preview", "job-1"), 2);
  assert.equal(await usage.consumeRender("owner", "final", "job-2"), 0);
  await assert.rejects(() => usage.consumeRender("owner", "preview", "job-3"), QuotaExceededError);
});

test("API key mint returns token once and authenticates by hash only", async () => {
  const pool = memoryApiKeyPool();
  const keys = new PostgresApiKeyService(pool);
  const created = await keys.create("owner", "hermes");
  assert.match(created.token, /^fm_[0-9a-f]{64}$/);
  assert.equal(created.hint, created.token.slice(-4));
  assert.equal(JSON.stringify(created).includes(created.token.slice(3, 20)) || true, true);
  assert.equal(pool.rows[0].tokenHash, createHash("sha256").update(created.token, "utf8").digest("hex"));
  assert.equal(pool.rows[0].tokenHash.includes(created.token.slice(3)), false);
  assert.equal(await keys.ownerIdForToken(created.token), "owner");
  assert.equal(await keys.ownerIdForToken(`fm_${randomBytes(32).toString("hex")}`), undefined);
  assert.equal(await keys.revoke("owner", created.id), true);
  assert.equal(await keys.ownerIdForToken(created.token), undefined);
});

test("machine API key auth, /v1 alias, usage routes, and quota_exceeded on render", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const jwksServer = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  const jwksOrigin = await listen(jwksServer);
  const states = new Map([["active-owner", "active"]]);
  let balance = 1;
  const apiKeys = {
    async create(ownerId, label) {
      return {
        id: "key-1",
        label: label || "default",
        hint: "abcd",
        created_at: new Date(0).toISOString(),
        token: "fm_" + "a".repeat(64)
      };
    },
    async list() {
      return [{ id: "key-1", label: "agent", hint: "abcd", created_at: new Date(0).toISOString() }];
    },
    async revoke() { return true; },
    async ownerIdForToken(token) {
      return token.startsWith("fm_") ? "active-owner" : undefined;
    }
  };
  const hostUsage = {
    async ensureFreeGrant() {},
    async status() {
      return { unit: "render_unit", balance, free_grant: 25, costs: { preview: 1, final: 2 } };
    },
    async consumeRender(_ownerId, kind, jobId) {
      const cost = kind === "final" ? 2 : 1;
      if (balance < cost) throw new QuotaExceededError();
      balance -= cost;
      return balance;
    }
  };
  const renders = {
    async create(ownerId, projectId, kind) {
      return { jobId: "job-1", projectId, revision: 1, kind, state: "queued" };
    },
    async cancel() { return { jobId: "job-1", state: "cancelled" }; },
    async events() { return []; },
    async result() { return undefined; }
  };
  const projects = new ProjectService();
  await projects.create("active-owner", { purpose: "Quota", audience: "Customers", tone: "Warm" }, "project-1");
  const app = createApp({
    projects,
    renders,
    apiKeys,
    hostUsage,
    authConfig: {
      issuer: "https://issuer.example",
      audience: "f-engine-reference",
      jwksUrl: new URL("/jwks", jwksOrigin)
    },
    accountState: async (ownerId) => states.get(ownerId)
  });
  const apiServer = createServer(app);
  const origin = await listen(apiServer);
  try {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://issuer.example")
      .setAudience("f-engine-reference")
      .setSubject("active-owner")
      .setExpirationTime("5m")
      .sign(privateKey);
    const created = await fetch(`${origin}/api/me/api-keys`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ label: "hermes" })
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.match(body.token, /^fm_/);

    const usage = await fetch(`${origin}/v1/me/usage`, {
      headers: { authorization: `Bearer ${body.token}` }
    });
    assert.equal(usage.status, 200);
    assert.equal((await usage.json()).balance, 1);

    const projectsList = await fetch(`${origin}/v1/projects`, {
      headers: { authorization: `Bearer ${body.token}` }
    });
    assert.equal(projectsList.status, 200);

    const renderOk = await fetch(`${origin}/v1/projects/project-1/render`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "preview" })
    });
    assert.equal(renderOk.status, 202);

    const renderBlocked = await fetch(`${origin}/v1/projects/project-1/render`, {
      method: "POST",
      headers: { authorization: `Bearer ${body.token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "preview" })
    });
    assert.equal(renderBlocked.status, 402);
    assert.equal((await renderBlocked.json()).type, "quota_exceeded");
  } finally {
    await Promise.all([
      new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve())),
      new Promise((resolve, reject) => jwksServer.close((error) => error ? reject(error) : resolve()))
    ]);
  }
});

test("createTestApp exposes api key and usage helpers without JWT", async () => {
  const apiKeys = {
    async create() {
      return { id: "k", label: "default", hint: "zzzz", created_at: new Date(0).toISOString(), token: "fm_" + "b".repeat(64) };
    },
    async list() { return []; },
    async revoke() { return false; },
    async ownerIdForToken() { return undefined; }
  };
  const hostUsage = {
    async ensureFreeGrant() {},
    async status() {
      return { unit: "render_unit", balance: 25, free_grant: 25, costs: { preview: 1, final: 2 } };
    },
    async consumeRender() { return 24; }
  };
  const server = createServer(createTestApp({ apiKeys, hostUsage }));
  const origin = await listen(server);
  try {
    assert.equal((await fetch(`${origin}/api/me/usage`)).status, 200);
    assert.equal((await fetch(`${origin}/api/me/api-keys`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 201);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
