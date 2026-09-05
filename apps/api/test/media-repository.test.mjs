import test from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  PexelsClient,
  PexelsRequestError,
  PostgresMediaRepository,
  PrivateObjectStore,
  pexelsQueriesForBrief,
  pexelsOrientation,
  rankPexelsResults,
  resolveSceneStockIntent,
  sceneStockIntent
} from "../dist/media-storage.js";

/** Fake pool that answers only the queries `completeAdmission` issues. */
function createFakePool(initialState) {
  let state = initialState;
  const outbox = [];
  const query = async (sql, params = []) => {
    if (sql.includes(`SET state = 'inspecting'`)) {
      if (state === "admitted" || state === "inspecting") { state = "inspecting"; return { rowCount: 1 }; }
      return { rowCount: 0 };
    }
    if (sql.startsWith(`INSERT INTO "WorkOutbox"`)) {
      const dedupeKey = params[1];
      if (outbox.some((row) => row.dedupeKey === dedupeKey)) return { rowCount: 0 };
      outbox.push({ dedupeKey, payload: params[2] });
      return { rowCount: 1 };
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    throw new Error(`unexpected query in fake pool: ${sql}`);
  };
  return {
    connect: async () => ({ query, release() {} }),
    getState: () => state,
    getOutbox: () => outbox
  };
}

test("completeAdmission marks the asset inspecting and enqueues the outbox row atomically", async () => {
  const pool = createFakePool("admitted");
  const repository = new PostgresMediaRepository(pool);
  assert.equal(await repository.completeAdmission("owner", "project", "asset"), true);
  assert.equal(pool.getState(), "inspecting");
  assert.deepEqual(pool.getOutbox().map((row) => row.dedupeKey), ["inspect-media:asset"]);
});

test("completeAdmission is idempotent via dedupeKey on repeat completion", async () => {
  const pool = createFakePool("admitted");
  const repository = new PostgresMediaRepository(pool);
  assert.equal(await repository.completeAdmission("owner", "project", "asset"), true);
  assert.equal(await repository.completeAdmission("owner", "project", "asset"), true);
  assert.equal(pool.getOutbox().length, 1);
});

test("completeAdmission rejects assets that are not admissible and enqueues nothing", async () => {
  const pool = createFakePool("ready");
  const repository = new PostgresMediaRepository(pool);
  assert.equal(await repository.completeAdmission("owner", "project", "asset"), false);
  assert.equal(pool.getState(), "ready");
  assert.equal(pool.getOutbox().length, 0);
});

test("signedPut binds the admitted byte ceiling and only targets quarantine", async () => {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://127.0.0.1:1",
    forcePathStyle: true,
    credentials: { accessKeyId: "fengine", secretAccessKey: "fengine-secret" }
  });
  const store = new PrivateObjectStore(client, "bucket");
  const url = new URL(await store.signedPut("projects/p/media-quarantine/a", "video/mp4", 4096));
  assert.match(String(url.searchParams.get("X-Amz-SignedHeaders")), /content-length/);
  assert.match(decodeURIComponent(url.pathname), /\/media-quarantine\/a$/);
  assert.doesNotMatch(decodeURIComponent(url.pathname), /\/media\/a$/);
});

test("PrivateObjectStore deletes an object by key", async () => {
  let input;
  const store = new PrivateObjectStore({
    async send(command) {
      input = command.input;
      assert.equal(command.constructor.name, "DeleteObjectCommand");
      return {};
    }
  }, "bucket");
  await store.delete("projects/p/renders/1.mp4");
  assert.deepEqual(input, { Bucket: "bucket", Key: "projects/p/renders/1.mp4" });
});

test("PrivateObjectStore uploads a multi-chunk stream with its known length", async () => {
  const chunks = [Buffer.from([1, 2]), Buffer.from([3, 4])];
  const body = Readable.from(chunks);
  let input;
  const store = new PrivateObjectStore({
    async send(command) { input = command.input; return { ETag: "\"etag\"" }; }
  }, "bucket");
  await store.put("object", body, "video/mp4", 4);
  assert.equal(input.Body, body);
  assert.equal(input.ContentLength, 4);
  assert.equal(input.ContentType, "video/mp4");
});

test("PrivateObjectStore copies and range-reads without buffering a full GetObject", async () => {
  const commands = [];
  const store = new PrivateObjectStore({
    async send(command) {
      commands.push(command);
      if (command.constructor.name === "CopyObjectCommand") {
        return { CopyObjectResult: { ETag: "\"copied\"" }, VersionId: "v1" };
      }
      return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
    }
  }, "bucket");
  assert.deepEqual(await store.copy("projects/p/media-quarantine/a", "projects/p/media-sealed/a"), {
    etag: "copied",
    versionId: "v1"
  });
  assert.deepEqual([...await store.readPrefix("projects/p/media-quarantine/a", 64)], [1, 2, 3]);
  assert.equal(commands[0].input.CopySource, "bucket/projects/p/media-quarantine/a");
  assert.equal(commands[0].input.Key, "projects/p/media-sealed/a");
  assert.equal(commands[1].input.Range, "bytes=0-63");
  assert.equal("Body" in commands[0].input, false);
});

test("PrivateObjectStore.exists is false for a missing object", async () => {
  const store = new PrivateObjectStore({
    async send() {
      const error = new Error("not found");
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    }
  }, "bucket");
  assert.equal(await store.exists("projects/p/media-quarantine/missing"), false);
});

/** Fake pool backing both `insert` (top-level query) and `completeAdmission` (transaction). */
function createFakeMediaPool() {
  const assets = new Map();
  const outbox = [];
  async function query(sql, params = []) {
    if (sql.startsWith(`INSERT INTO "MediaAsset"`)) {
      const [id, ownerId, projectId, quarantineObjectKey, state, declaredType, maxBytes, detected, attribution] = params;
      assets.set(id, { id, ownerId, projectId, quarantineObjectKey, state, declaredType, maxBytes, detected, attribution });
      return { rowCount: 1 };
    }
    if (sql.includes(`SET state = 'inspecting'`)) {
      const [ownerId, projectId, id] = params;
      const row = assets.get(id);
      if (row && row.ownerId === ownerId && row.projectId === projectId
        && (row.state === "admitted" || row.state === "inspecting")) {
        row.state = "inspecting";
        return { rowCount: 1 };
      }
      return { rowCount: 0 };
    }
    if (sql.startsWith(`INSERT INTO "WorkOutbox"`)) {
      const dedupeKey = params[1];
      if (outbox.some((row) => row.dedupeKey === dedupeKey)) return { rowCount: 0 };
      outbox.push({ dedupeKey, payload: params[2] });
      return { rowCount: 1 };
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    throw new Error(`unexpected query in fake pool: ${sql}`);
  }
  return { query, connect: async () => ({ query, release() {} }), getAssets: () => assets, getOutbox: () => outbox };
}

test("PexelsClient.copy admits the asset for worker inspection instead of trusting it as ready", async () => {
  const pool = createFakeMediaPool();
  const repository = new PostgresMediaRepository(pool);
  const objects = new Map();
  let uploadedPath;
  const store = {
    async put(objectKey, body, _contentType, contentLength) {
      uploadedPath = body.path;
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, contentLength);
      objects.set(objectKey, bytes);
    }
  };
  const pexels = new PexelsClient("server-only-key", async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }));
  const selected = {
    id: 1,
    creator: "Fixture Creator",
    attributionUrl: "https://www.pexels.com/video/1",
    previewUrl: "https://images.pexels.com/videos/1/preview.jpg",
    sourceUrl: "https://media.pexels.test/1.mp4",
    contentType: "video/mp4"
  };
  const asset = await pexels.copy("owner", "project", selected, repository, store);
  assert.equal(asset.state, "inspecting");
  assert.equal(asset.detected, undefined);
  assert.equal(pool.getAssets().get(asset.id).state, "inspecting");
  assert.deepEqual(pool.getAssets().get(asset.id).attribution, {
    source: "Pexels",
    creator: "Fixture Creator",
    url: "https://www.pexels.com/video/1",
    previewUrl: "https://images.pexels.com/videos/1/preview.jpg"
  });
  assert.equal("sourceUrl" in pool.getAssets().get(asset.id).attribution, false);
  assert.deepEqual(pool.getOutbox().map((row) => row.dedupeKey), [`inspect-media:${asset.id}`]);
  assert.equal(objects.has(asset.quarantineObjectKey), true);
  assert.deepEqual([...objects.get(asset.quarantineObjectKey)], [1, 2, 3, 4]);
  assert.match(asset.quarantineObjectKey, /\/media-quarantine\//);
  await assert.rejects(access(uploadedPath), { code: "ENOENT" });
});

test("PexelsClient.copy removes its private spool when upload fails", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fengine-pexels-test-"));
  let uploadedPath;
  try {
    const pexels = new PexelsClient(
      "server-only-key",
      async () => new Response(new Uint8Array([1, 2, 3])),
      30_000,
      temporaryRoot
    );
    await assert.rejects(
      () => pexels.copy("owner", "project", {
        id: 1,
        creator: "Fixture Creator",
        attributionUrl: "https://www.pexels.com/video/1",
        previewUrl: "https://images.pexels.com/videos/1/preview.jpg",
        sourceUrl: "https://media.pexels.test/1.mp4",
        contentType: "video/mp4"
      }, new PostgresMediaRepository(createFakeMediaPool()), {
        async put(_key, body) {
          uploadedPath = body.path;
          throw new Error("upload failed");
        }
      }),
      /upload failed/
    );
    await assert.rejects(access(uploadedPath), { code: "ENOENT" });
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("PexelsClient.copy bounds the provider request deadline and cleans up", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "fengine-pexels-test-"));
  try {
    const pexels = new PexelsClient(
      "server-only-key",
      async (_url, init) => await new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      }),
      10,
      temporaryRoot
    );
    await assert.rejects(() => pexels.copy("owner", "project", {
      id: 1,
      creator: "Fixture Creator",
      attributionUrl: "https://www.pexels.com/video/1",
      previewUrl: "https://images.pexels.com/videos/1/preview.jpg",
      sourceUrl: "https://media.pexels.test/1.mp4",
      contentType: "video/mp4"
    }, new PostgresMediaRepository(createFakeMediaPool()), { async put() {} }), /abort/i);
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("PexelsClient.copy rejects unsafe attribution metadata before downloading or persisting", async () => {
  for (const unsafe of [
    { attributionUrl: "http://www.pexels.com/video/1" },
    { previewUrl: "http://images.pexels.com/videos/1/preview.jpg" }
  ]) {
    let requests = 0;
    const pool = createFakeMediaPool();
    const pexels = new PexelsClient("server-only-key", async () => {
      requests += 1;
      return new Response(new Uint8Array([1]), { status: 200 });
    });
    await assert.rejects(() => pexels.copy("owner", "project", {
      id: 1,
      creator: "Fixture Creator",
      attributionUrl: "https://www.pexels.com/video/1",
      previewUrl: "https://images.pexels.com/videos/1/preview.jpg",
      sourceUrl: "https://media.pexels.test/1.mp4",
      contentType: "video/mp4",
      ...unsafe
    }, new PostgresMediaRepository(pool), { put: async () => undefined }), /metadata rejected/);
    assert.equal(requests, 0);
    assert.equal(pool.getAssets().size, 0);
  }
});

test("PexelsClient.search uses the v1 portrait endpoint and maps safe previews", async () => {
  let requested;
  const pexels = new PexelsClient("server-only-key", async (url) => {
    requested = new URL(url);
    return Response.json({
      videos: [
        {
          id: 1,
          url: "https://www.pexels.com/video/1",
          image: "https://images.pexels.com/videos/1/preview.jpg",
          user: { name: "Fixture Creator" },
          video_files: [
            { link: "https://media.pexels.test/wide.mp4", file_type: "video/mp4", width: 1920 },
            { link: "https://media.pexels.test/near.mp4", file_type: "video/mp4", width: 720 },
            { link: "https://media.pexels.test/final.mp4", file_type: "video/mp4", width: 1080 },
            {
              link: "https://media.pexels.test/oversized.mp4",
              file_type: "video/mp4",
              width: 1080,
              file_size: 100000001
            }
          ]
        },
        {
          id: 2,
          url: "https://www.pexels.com/video/2",
          image: "http://insecure.example/preview.jpg",
          user: { name: "Unsafe Preview" },
          video_files: [{ link: "https://media.pexels.test/2.mp4", file_type: "video/mp4", width: 720 }]
        },
        {
          id: 3,
          url: "http://www.pexels.com/video/3",
          image: "https://images.pexels.com/videos/3/preview.jpg",
          user: { name: "Unsafe Attribution" },
          video_files: [{ link: "https://media.pexels.test/3.mp4", file_type: "video/mp4", width: 720 }]
        }
      ]
    });
  });
  const results = await pexels.search("small teams");
  assert.equal(requested.pathname, "/v1/videos/search");
  assert.equal(requested.searchParams.get("orientation"), "portrait");
  assert.equal(requested.searchParams.get("per_page"), "12");
  assert.deepEqual(results, [{
    id: 1,
    creator: "Fixture Creator",
    attributionUrl: "https://www.pexels.com/video/1",
    previewUrl: "https://images.pexels.com/videos/1/preview.jpg",
    sourceUrl: "https://media.pexels.test/final.mp4",
    contentType: "video/mp4"
  }]);
});

test("PexelsClient.search maps malformed provider data to a safe typed error", async () => {
  const pexels = new PexelsClient("server-only-key", async () => new Response("not json", { status: 200 }));
  await assert.rejects(pexels.search("ocean"), (error) => error instanceof PexelsRequestError);
});

test("Pexels brief queries prefer concrete visual language over narrative prose", () => {
  assert.deepEqual(
    pexelsQueriesForBrief(
      "A lonely island appears through the ocean mist. No maps record it, and every night a mysterious light shines from its abandoned lighthouse."
    ),
    [
      "lonely island ocean fog mysterious abandoned lighthouse",
      "lonely island ocean fog"
    ]
  );
  assert.deepEqual(
    pexelsQueriesForBrief("Make a video"),
    ["cinematic"]
  );
});

test("rankPexelsResults scores slug overlap and sorts by fit", async () => {
  const intent = await resolveSceneStockIntent("lonely island fog lighthouse", "Abandoned lighthouse in fog", "fog wide aerial establishing");
  const ranked = rankPexelsResults([
    {
      id: 2,
      creator: "B",
      attributionUrl: "https://www.pexels.com/video/city-traffic-night-2/",
      previewUrl: "https://images.pexels.com/videos/2/preview.jpg",
      sourceUrl: "https://media.pexels.test/2.mp4",
      contentType: "video/mp4"
    },
    {
      id: 1,
      creator: "A",
      attributionUrl: "https://www.pexels.com/video/lonely-island-lighthouse-fog-1/",
      previewUrl: "https://images.pexels.com/videos/1/preview.jpg",
      sourceUrl: "https://media.pexels.test/1.mp4",
      contentType: "video/mp4"
    }
  ], intent.intent_tokens, "lonely island fog lighthouse");
  assert.equal(ranked[0].id, 1);
  assert.ok(ranked[0].fit > ranked[1].fit);
});

test("pexelsOrientation follows delivery platform", () => {
  assert.equal(pexelsOrientation({ goal: "promote", audience: "social", structure: "story_arc", tone: "cinematic", pace: "balanced", durationSeconds: 15, media: "stock", delivery: "youtube" }), "landscape");
  assert.equal(pexelsOrientation({ goal: "promote", audience: "social", structure: "story_arc", tone: "cinematic", pace: "balanced", durationSeconds: 15, media: "stock", delivery: "reel" }), "portrait");
});
