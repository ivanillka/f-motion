import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { credentialVaultFromEnv } from "@f-engine/fal-host";
import {
  CivitaiClient,
  FalClipScorer,
  MemoryCivitaiEmbeddingCache,
  civitaiAttributionUrlAllowed,
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
import {
  CivitaiSettingsValidationError,
  PostgresCivitaiSettingsService
} from "../dist/civitai-settings.js";
import { createTestApp } from "../dist/server.js";

const vaultEnv = {
  FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 7).toString("base64")
};

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0, 0, 0x04, 0x00, 0, 0, 0x03, 0x00, 8, 2, 0, 0, 0
]);

function imageItem(overrides = {}) {
  return {
    id: 1,
    url: "https://image.civitai.com/x/u/original=true/u.png",
    width: 1080,
    height: 1920,
    nsfwLevel: "None",
    browsingLevel: 1,
    type: "image",
    username: "alice",
    baseModel: "Flux",
    postId: 99,
    ...overrides
  };
}

function selectedImage(overrides = {}) {
  return {
    id: 1,
    creator: "alice",
    attributionUrl: "https://civitai.com/images/1",
    postId: 99,
    postUrl: "https://civitai.com/posts/99",
    previewUrl: "https://image.civitai.com/x/u/width=450/u.png",
    sourceUrl: "https://image.civitai.com/x/u/width=1280/u.png",
    contentType: "image/png",
    width: 1080,
    height: 1920,
    nsfwLevel: "None",
    browsingLevel: 1,
    baseModel: "Flux",
    ...overrides
  };
}

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
  assert.equal(policy.minShortSide, 1080);
  assert.equal(civitaiUrlAllowed("https://image.civitai.com/x/y.jpeg", policy.allowedMediaHosts), true);
  assert.equal(civitaiUrlAllowed("https://evil.example/x.jpeg", policy.allowedMediaHosts), false);
  assert.equal(civitaiAttributionUrlAllowed("https://civitai.com/images/1", "images", 1), true);
  assert.equal(civitaiAttributionUrlAllowed("https://civitai.com/posts/9", "posts", 9), true);
  assert.equal(civitaiAttributionUrlAllowed("https://civitai.com/images/2", "images", 1), false);
  assert.equal(civitaiAttributionUrlAllowed("https://evil.example/images/1", "images", 1), false);
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

test("Civitai credential lifecycle is owner-scoped and keyless at safe levels", async () => {
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
  const anonymous = await service.optionalClient("owner", { ...defaultCivitaiPolicy, nsfwLevel: "Soft" });
  assert.equal(anonymous.apiKey, undefined);
  await assert.rejects(service.optionalClient("owner", { ...defaultCivitaiPolicy, nsfwLevel: "Mature" }));
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


test("Civitai search uses models then images, allows lower NSFW levels, and enforces filters keylessly", async () => {
  const calls = [];
  const client = new CivitaiClient(undefined, {
    ...defaultCivitaiPolicy,
    nsfwLevel: "Soft",
    allowedCreators: ["Alice"],
    minShortSide: 1080
  }, async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/api/v1/models?")) {
      assert.match(url, /query=cinematic/);
      return new Response(JSON.stringify({ items: [{ id: 11 }] }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    assert.match(url, /browsingLevel=3/);
    assert.match(url, /modelId=11/);
    return new Response(JSON.stringify({
      items: [
        imageItem({ id: 1 }),
        imageItem({ id: 2, nsfwLevel: "Soft", browsingLevel: 2 }),
        imageItem({ id: 3, nsfwLevel: "Mature", browsingLevel: 4 }),
        imageItem({ id: 4, username: "bob" }),
        imageItem({ id: 5, width: 800, height: 1200 }),
        imageItem({ id: 6, url: "https://evil.example/u.png" })
      ],
      metadata: { nextCursor: "feed:1" }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const page = await client.search({ query: "cinematic", orientation: "portrait" });
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.equal(page.nextCursor, "feed:1");
  assert.equal(page.modelId, 11);
  assert.deepEqual(page.results.map((result) => result.id), [1, 2]);
  assert.equal(page.results[0].postId, 99);
  assert.equal(page.results[0].postUrl, "https://civitai.com/posts/99");
  assert.equal(page.results[0].attributionUrl, "https://civitai.com/images/1");
  assert.match(page.results[0].previewUrl, /width=450/);
  assert.match(page.results[0].sourceUrl, /width=1280/);
});


function fakeStore() {
  const puts = [];
  return {
    puts,
    async put(key, body, type, length) {
      puts.push({ key, type, length });
      if (body && typeof body[Symbol.asyncIterator] === "function") {
        for await (const _chunk of body) { /* drain */ }
      }
      return { etag: "etag-put" };
    },
    async readPrefix() { return png; },
    async copy() { return { etag: "etag-copy" }; }
  };
}

function fakeRepository() {
  return {
    asset: undefined,
    async insert(asset) { this.asset = asset; },
    async markImportedStillReady(_ownerId, _projectId, _id, sealed, detected) {
      return { ...this.asset, state: "ready", sealedObjectKey: sealed.objectKey, detected };
    }
  };
}

test("Civitai copy accepts the default policy attribution URLs and stores post attribution", async () => {
  const store = fakeStore();
  const repository = fakeRepository();
  const client = new CivitaiClient("key", defaultCivitaiPolicy, async (url) => {
    assert.equal(url, "https://image.civitai.com/x/u/width=1280/u.png");
    return new Response(png, { status: 200, headers: { "content-type": "application/octet-stream" } });
  });
  const asset = await client.copy("owner", "project", selectedImage(), repository, store);
  assert.equal(asset.state, "ready");
  assert.equal(store.puts.length, 1);
  assert.deepEqual(repository.asset.attribution, {
    source: "Civitai",
    creator: "alice",
    url: "https://civitai.com/images/1",
    previewUrl: "https://image.civitai.com/x/u/width=450/u.png",
    postId: 99,
    postUrl: "https://civitai.com/posts/99"
  });
});

test("Civitai copy refuses a redirect to a non-allowed host without fetching it", async () => {
  const calls = [];
  const client = new CivitaiClient("key", defaultCivitaiPolicy, async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/stolen.png" }
    });
  });
  await assert.rejects(
    () => client.copy("owner", "project", selectedImage(), fakeRepository(), fakeStore()),
    /origin is not allowed|redirect/
  );
  assert.deepEqual(calls, ["https://image.civitai.com/x/u/width=1280/u.png"]);
});


test("Civitai ranking falls back to text and accepts an image-text scorer", async () => {
  const results = [
    selectedImage({ id: 1, previewUrl: "https://image.civitai.com/p1.jpeg" }),
    selectedImage({ id: 2, previewUrl: "https://image.civitai.com/p2.jpeg", baseModel: "Pony" })
  ];
  const fallback = await rankCivitaiResults(results, ["cinematic"], "cinematic");
  assert.equal(fallback[0].score_source, "text_fallback");
  const scorer = {
    async score({ imageId }) {
      return imageId === 2 ? 1 : 0;
    }
  };
  const ranked = await rankCivitaiResults(results, ["cinematic"], "cinematic", scorer);
  assert.equal(ranked[0].id, 2);
  assert.equal(ranked[0].score_source, "image_text");
  assert.equal(civitaiTextFitScore(["cinematic"], "cinematic"), 100);
});

test("FAL CLIP scorer caches image embeddings by image id and uses the owner key", async () => {
  const bodies = [];
  const cache = new MemoryCivitaiEmbeddingCache();
  const scorer = new FalClipScorer("fal-key", async (url, init) => {
    assert.equal(url, "https://fal.run/fal-ai/clip");
    assert.equal(init.headers.authorization, "Key fal-key");
    const body = JSON.parse(init.body);
    bodies.push(body);
    return new Response(JSON.stringify(
      body.image_embedding
        ? { image_embedding: body.image_embedding, text_embedding: [1, 0] }
        : { image_embedding: [1, 0], text_embedding: [1, 0] }
    ), { status: 200, headers: { "content-type": "application/json" } });
  }, cache);
  const first = await scorer.score({ imageId: 7, imageUrl: "https://image.civitai.com/x.png", text: "harbor" });
  const second = await scorer.score({ imageId: 7, imageUrl: "https://image.civitai.com/x.png", text: "harbor" });
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(bodies[0].image_embedding, undefined);
  assert.deepEqual(bodies[1].image_embedding, [1, 0]);
});


test("Civitai owner settings cap the NSFW level and validate the creator allowlist", async () => {
  let stored;
  const pool = {
    async query(sql, params = []) {
      if (sql.startsWith("SELECT")) return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
      if (sql.startsWith("INSERT")) {
        stored = {
          maxNsfwLevel: params[1],
          allowedCreators: params[2],
          minShortSide: params[3]
        };
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const service = new PostgresCivitaiSettingsService(pool, defaultCivitaiPolicy);
  assert.deepEqual(await service.get("owner"), {
    maxNsfwLevel: "None",
    allowedCreators: [],
    minShortSide: 1080,
    serverMaxNsfwLevel: "None"
  });
  const updated = await service.update("owner", {
    max_nsfw_level: "Mature",
    allowed_creators: ["Alice", "alice", "bob"],
    min_short_side: 720
  });
  assert.equal(updated.maxNsfwLevel, "None");
  assert.deepEqual(updated.allowedCreators, ["Alice", "bob"]);
  assert.equal(updated.minShortSide, 720);
  await assert.rejects(
    () => service.update("owner", { allowed_creators: ["bad creator"] }),
    (error) => error instanceof CivitaiSettingsValidationError
  );
  await assert.rejects(
    () => service.update("owner", { min_short_side: 100 }),
    (error) => error instanceof CivitaiSettingsValidationError
  );
});

test("Civitai settings routes are owner-scoped and redacted", async () => {
  const calls = [];
  const settings = {
    async get(ownerId) {
      calls.push(["get", ownerId]);
      return { maxNsfwLevel: "None", allowedCreators: [], minShortSide: 1080, serverMaxNsfwLevel: "Soft" };
    },
    async update(ownerId, value) {
      calls.push(["update", ownerId, value]);
      return { maxNsfwLevel: "Soft", allowedCreators: ["alice"], minShortSide: 1080, serverMaxNsfwLevel: "Soft" };
    }
  };
  const server = createServer(createTestApp({ ownerId: "route-owner", civitaiSettings: settings }));
  const origin = await listen(server);
  try {
    const initial = await fetch(`${origin}/api/providers/civitai/settings`);
    assert.equal(initial.status, 200);
    assert.equal((await initial.json()).server_max_nsfw_level, "Soft");
    const updated = await fetch(`${origin}/api/providers/civitai/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ max_nsfw_level: "Soft", allowed_creators: ["alice"] })
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).max_nsfw_level, "Soft");
    assert.ok(calls.every(([, ownerId]) => ownerId === "route-owner"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

