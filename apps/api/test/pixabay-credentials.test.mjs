import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { credentialVaultFromEnv } from "@f-engine/fal-host";
import {
  PixabayProviderError,
  PostgresPixabayCredentialService,
  pixabayByokEnabled,
  validatePixabayCredential
} from "../dist/pixabay-credentials.js";
import { PixabayClient, sceneMediaView } from "../dist/media-storage.js";
import { createTestApp } from "../dist/server.js";
import { listingHasCapability } from "../dist/provider-catalog.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function pixabayFetch(status = 200) {
  return async (url) => {
    assert.match(String(url), /key=synthetic-pixabay-key-5678/);
    if (status !== 200) return new Response("upstream detail must not escape", { status });
    return new Response(JSON.stringify({ hits: [] }), {
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
        id, ownerId, provider: "pixabay", ciphertext: Buffer.from(ciphertext), nonce: Buffer.from(nonce),
        authTag: Buffer.from(authTag), keyVersion, hint, validatedAt
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected fake query: ${sql}`);
  };
  return { query, connect: async () => ({ query, release() {} }), rows };
}

test("Pixabay BYOK configuration and validation fail closed", async () => {
  assert.equal(pixabayByokEnabled({}), false);
  assert.equal(pixabayByokEnabled({ FENGINE_PIXABAY_BYOK_ENABLED: "1" }), true);
  assert.throws(() => pixabayByokEnabled({ FENGINE_PIXABAY_BYOK_ENABLED: "yes" }));
  await validatePixabayCredential("synthetic-pixabay-key-5678", pixabayFetch());
  for (const status of [401, 403]) {
    await assert.rejects(
      validatePixabayCredential("synthetic", pixabayFetch(status)),
      (error) => error instanceof PixabayProviderError && error.code === "credential"
    );
  }
  for (const response of [
    new Response("busy", { status: 429 }),
    new Response("broken", { status: 500 }),
    new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "content-type": "text/plain" } }),
    new Response(JSON.stringify({ videos: [] }), { status: 200, headers: { "content-type": "application/json" } })
  ]) {
    await assert.rejects(
      validatePixabayCredential("synthetic", async () => response),
      (error) => error instanceof PixabayProviderError && error.code === "unavailable"
    );
  }
});

test("Pixabay credential is encrypted, owner-scoped, and never projected", async () => {
  const pool = fakePool();
  const vault = credentialVaultFromEnv({
    FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
    FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 8).toString("base64")
  });
  const service = new PostgresPixabayCredentialService(pool, vault, pixabayFetch());
  const connected = await service.connect("owner", "synthetic-pixabay-key-5678");
  assert.deepEqual(connected, {
    provider: "pixabay", connected: true, hint: "5678", validated_at: connected.validated_at
  });
  assert.equal(JSON.stringify(connected).includes("synthetic"), false);
  assert.equal(pool.rows.get("owner").ciphertext.toString("utf8").includes("synthetic"), false);
  assert.deepEqual(await service.status("other"), { provider: "pixabay", connected: false });
  await service.disconnect("other");
  assert.equal((await service.status("owner")).connected, true);
});

test("Pixabay search keeps portrait hits and caches the catalog response", async () => {
  let calls = 0;
  const client = new PixabayClient("synthetic-pixabay-key-5678", async (url) => {
    calls += 1;
    assert.match(String(url), /pixabay.com\/api\/videos\//);
    return new Response(JSON.stringify({
      hits: [
        {
          id: 9,
          pageURL: "https://pixabay.com/videos/id-9/",
          user: "Ada",
          videos: {
            medium: { url: "https://cdn.pixabay.com/video/9.mp4", width: 1080, height: 1920, thumbnail: "https://cdn.pixabay.com/video/9.jpg" }
          }
        },
        {
          id: 8,
          pageURL: "https://pixabay.com/videos/id-8/",
          user: "Wide",
          videos: {
            medium: { url: "https://cdn.pixabay.com/video/8.mp4", width: 1920, height: 1080, thumbnail: "https://cdn.pixabay.com/video/8.jpg" }
          }
        }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const first = await client.search("lighthouse");
  const second = await client.search("lighthouse");
  assert.equal(calls, 1);
  assert.equal(first.length, 1);
  assert.equal(first[0].id, 9);
  assert.equal(first[0].creator, "Ada");
  assert.deepEqual(second, first);
  assert.deepEqual(sceneMediaView({
    id: "asset",
    ownerId: "owner",
    projectId: "project",
    state: "ready",
    declaredType: "video/mp4",
    maxBytes: 12,
    attribution: {
      source: "Pixabay",
      creator: "Ada",
      url: "https://pixabay.com/videos/id-9/",
      previewUrl: "https://cdn.pixabay.com/video/9.jpg"
    }
  }).attribution, {
    source: "Pixabay",
    creator: "Ada",
    attributionUrl: "https://pixabay.com/videos/id-9/",
    previewUrl: "https://cdn.pixabay.com/video/9.jpg"
  });
});

test("Pixabay still search is vertical and cached", async () => {
  let calls = 0;
  const client = new PixabayClient("synthetic-pixabay-key-5678", async (url) => {
    calls += 1;
    assert.match(String(url), /pixabay.com\/api\/\?/);
    assert.match(String(url), /orientation=vertical/);
    return new Response(JSON.stringify({
      hits: [{
        id: 3,
        pageURL: "https://pixabay.com/photos/id-3/",
        user: "Bea",
        previewURL: "https://cdn.pixabay.com/photo/3-small.jpg",
        largeImageURL: "https://cdn.pixabay.com/photo/3.jpg"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const first = await client.searchStills("lighthouse");
  await client.searchStills("lighthouse");
  assert.equal(calls, 1);
  assert.equal(first[0].id, 3);
  assert.equal(first[0].contentType, "image/jpeg");
});

test("provider catalog and Pixabay routes are owner-scoped", async () => {
  const owners = [];
  const server = createServer(createTestApp({
    ownerId: "media-owner",
    pexelsCredentials: {
      async status() { return { provider: "pexels", connected: false }; }
    },
    pixabayCredentials: {
      async status() { return { provider: "pixabay", connected: true, hint: "5678" }; }
    },
    falCredentials: {
      async status() { return { provider: "fal", connected: false }; }
    },
    media: {
      repository: {}, store: {},
      pixabayForOwner: async (ownerId) => {
        owners.push(ownerId);
        return { async search() { return []; }, async searchStills() { return []; } };
      }
    }
  }));
  const origin = await listen(server);
  try {
    const listing = await (await fetch(`${origin}/api/providers`)).json();
    assert.equal(listingHasCapability(listing.providers, "stock_video"), true);
    assert.equal(listingHasCapability(listing.providers, "ai_image"), false);
    const search = await fetch(`${origin}/api/pixabay/search?q=ocean`);
    assert.equal(search.status, 200);
    assert.deepEqual(await search.json(), { results: [] });
    assert.deepEqual(owners, ["media-owner"]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
