import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { credentialVaultFromEnv } from "@f-engine/fal-host";
import {
  CivitaiClient,
  civitaiPolicyFromEnv,
  civitaiTextFitScore,
  civitaiUrlAllowed,
  defaultCivitaiPolicy,
  rankCivitaiResults
} from "../dist/civitai.js";
import {
  PostgresCivitaiCredentialService,
  civitaiByokEnabled,
  validateCivitaiCredential
} from "../dist/civitai-credentials.js";
import { createTestApp } from "../dist/server.js";

const vaultEnv = {
  FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 7).toString("base64")
};

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("Civitai BYOK configuration and policy fail closed", async () => {
  assert.equal(civitaiByokEnabled({}), false);
  assert.equal(civitaiByokEnabled({ FENGINE_CIVITAI_BYOK_ENABLED: "1" }), true);
  assert.throws(() => civitaiByokEnabled({ FENGINE_CIVITAI_BYOK_ENABLED: "yes" }));
  const policy = civitaiPolicyFromEnv({});
  assert.equal(policy.nsfwLevel, "None");
  assert.equal(civitaiUrlAllowed("https://image.civitai.com/x/y.jpeg", policy.allowedMediaHosts), true);
  assert.equal(civitaiUrlAllowed("https://evil.example/x.jpeg", policy.allowedMediaHosts), false);
  assert.throws(() => civitaiPolicyFromEnv({ FENGINE_CIVITAI_NSFW_LEVEL: "Blocked" }));
  assert.throws(() => civitaiPolicyFromEnv({ FENGINE_CIVITAI_ALLOWED_MEDIA_HOSTS: "" }));
});

test("Civitai credential validation redacts upstream detail", async () => {
  const ok = async (_url, init) => {
    assert.equal(init.headers.authorization, "Bearer synthetic-civitai-key-1234");
    return new Response(JSON.stringify({ id: 7 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  await validateCivitaiCredential("synthetic-civitai-key-1234", ok);
  for (const status of [401, 403]) {
    await assert.rejects(
      validateCivitaiCredential("synthetic", async () => new Response("no", { status })),
      (error) => error instanceof Error && error.name === "CivitaiProviderError" && error.code === "credential"
    );
  }
  await assert.rejects(
    validateCivitaiCredential("synthetic", async () => new Response("broken", { status: 500 })),
    (error) => error instanceof Error && error.name === "CivitaiProviderError" && error.code === "unavailable"
  );
});

test("Civitai credential lifecycle is owner-scoped and encrypted", async () => {
  const vault = credentialVaultFromEnv(vaultEnv);
  const rows = new Map();
  const fakeQuery = async (sql, params = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.startsWith(`SELECT id FROM "User"`)) return { rows: [{ id: params[0] }], rowCount: 1 };
    if (sql.startsWith(`SELECT id FROM "ProviderCredential"`)) {
      const row = rows.get(params[0]);
      return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith(`SELECT id, "ownerId"`)) {
      const row = rows.get(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith(`INSERT INTO "ProviderCredential"`)) {
      rows.set(params[1], { id: params[0], ownerId: params[1], provider: "civitai", ciphertext: Buffer.from(params[2]), nonce: Buffer.from(params[3]), authTag: Buffer.from(params[4]), keyVersion: params[5], hint: params[6], validatedAt: params[7] });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith(`UPDATE "ProviderCredential"`)) return { rows: [], rowCount: 1 };
    if (sql.startsWith(`DELETE FROM "ProviderCredential"`)) {
      rows.delete(params[0]);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const pool = {
    query: fakeQuery,
    async connect() {
      return { query: fakeQuery, release() {} };
    }
  };
  const service = new PostgresCivitaiCredentialService(pool, vault, defaultCivitaiPolicy, async (_url, init) => {
    assert.equal(init.headers.authorization, "Bearer synthetic-civitai-key-1234");
    return new Response(JSON.stringify({ id: 7 }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.deepEqual(await service.status("owner"), { provider: "civitai", connected: false });
  const connected = await service.connect("owner", "synthetic-civitai-key-1234");
  assert.equal(connected.provider, "civitai");
  assert.equal(connected.hint, "1234");
  assert.equal(rows.get("owner").ciphertext.toString("utf8").includes("synthetic"), false);
  assert.equal((await service.client("owner").then((client) => client.apiKey)), "synthetic-civitai-key-1234");
  await assert.rejects(service.client("other"));
  await service.disconnect("owner");
  assert.deepEqual(await service.status("owner"), { provider: "civitai", connected: false });
});

test("Civitai search applies safe defaults, host allowlist, and orientation", async () => {
  let requested = "";
  const client = new CivitaiClient("key", defaultCivitaiPolicy, async (url, init) => {
    requested = url;
    assert.equal(init.headers.authorization, "Bearer key");
    return new Response(JSON.stringify({
      items: [
        { id: 1, url: "https://image.civitai.com/x/u/original=true/u.jpeg", width: 1080, height: 1920, nsfwLevel: "None", browsingLevel: 1, type: "image", username: "alice", baseModel: "Flux" },
        { id: 2, url: "https://evil.example/u.jpeg", width: 1080, height: 1920, nsfwLevel: "None", browsingLevel: 1, type: "image", username: "bob" },
        { id: 3, url: "https://image.civitai.com/x/u/original=true/u.jpeg", width: 1920, height: 1080, nsfwLevel: "Soft", browsingLevel: 2, type: "image", username: "carol" }
      ],
      metadata: { nextCursor: "feed:1" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const page = await client.search("cinematic", "portrait");
  assert.match(requested, /nsfw=None/);
  assert.match(requested, /query=cinematic/);
  assert.equal(page.nextCursor, "feed:1");
  assert.equal(page.results.length, 1);
  assert.equal(page.results[0].id, 1);
  assert.equal(page.results[0].attributionUrl, "https://civitai.com/images/1");
  assert.match(page.results[0].previewUrl, /width=450/);
  assert.match(page.results[0].sourceUrl, /width=1280/);
});

test("Civitai ranking falls back to text and accepts an image-text scorer", async () => {
  const results = [
    { id: 1, creator: "a", attributionUrl: "https://civitai.com/images/1", previewUrl: "https://image.civitai.com/p1.jpeg", sourceUrl: "https://image.civitai.com/s1.jpeg", contentType: "image/jpeg", width: 100, height: 100, nsfwLevel: "None", browsingLevel: 1, baseModel: "Flux" },
    { id: 2, creator: "b", attributionUrl: "https://civitai.com/images/2", previewUrl: "https://image.civitai.com/p2.jpeg", sourceUrl: "https://image.civitai.com/s2.jpeg", contentType: "image/jpeg", width: 100, height: 100, nsfwLevel: "None", browsingLevel: 1, baseModel: "Pony" }
  ];
  const fallback = await rankCivitaiResults(results, ["cinematic"], "cinematic");
  assert.equal(fallback[0].score_source, "text_fallback");
  const scorer = {
    async score({ imageUrl }) {
      return imageUrl.endsWith("p2.jpeg") ? 1 : 0;
    }
  };
  const ranked = await rankCivitaiResults(results, ["cinematic"], "cinematic", scorer);
  assert.equal(ranked[0].id, 2);
  assert.equal(ranked[0].score_source, "image_text");
  assert.equal(civitaiTextFitScore(["cinematic"], "cinematic"), 100);
});

test("Civitai credential routes are exact, redacted, and owner-scoped", async () => {
  const service = {
    async status(ownerId) { return { provider: "civitai", connected: false, ownerId }; },
    async connect() { return { provider: "civitai", connected: true, hint: "1234" }; },
    async test() { return { provider: "civitai", connected: true, hint: "1234" }; },
    async disconnect() {},
    async client() { throw new Error("unused"); }
  };
  const server = createServer(createTestApp({ ownerId: "route-owner", civitaiCredentials: service }));
  const origin = await listen(server);
  try {
    assert.equal((await (await fetch(`${origin}/api/providers/civitai/credential`)).json()).provider, "civitai");
    const bad = await fetch(`${origin}/api/providers/civitai/credential`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: "x", extra: true })
    });
    assert.equal(bad.status, 422);
    const connected = await fetch(`${origin}/api/providers/civitai/credential`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: "x" })
    });
    assert.equal(connected.status, 200);
    assert.equal((await connected.text()).includes("x"), false);
    assert.equal((await fetch(`${origin}/api/providers/civitai/credential/test`, { method: "POST" })).status, 200);
    assert.equal((await fetch(`${origin}/api/providers/civitai/credential`, { method: "DELETE" })).status, 204);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

