import test from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { PexelsClient, PostgresMediaRepository, PrivateObjectStore } from "../dist/media-storage.js";

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

test("signedPut binds the admitted byte ceiling into the presigned PUT request", async () => {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://127.0.0.1:1",
    forcePathStyle: true,
    credentials: { accessKeyId: "fengine", secretAccessKey: "fengine-secret" }
  });
  const store = new PrivateObjectStore(client, "bucket");
  const url = new URL(await store.signedPut("projects/p/media/a", "video/mp4", 4096));
  assert.match(String(url.searchParams.get("X-Amz-SignedHeaders")), /content-length/);
});

/** Fake pool backing both `insert` (top-level query) and `completeAdmission` (transaction). */
function createFakeMediaPool() {
  const assets = new Map();
  const outbox = [];
  async function query(sql, params = []) {
    if (sql.startsWith(`INSERT INTO "MediaAsset"`)) {
      const [id, ownerId, projectId, objectKey, state, declaredType, maxBytes, detected, attribution] = params;
      assets.set(id, { id, ownerId, projectId, objectKey, state, declaredType, maxBytes, detected, attribution });
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
  const store = { put: async (objectKey, body) => objects.set(objectKey, body) };
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
  assert.deepEqual(pool.getOutbox().map((row) => row.dedupeKey), [`inspect-media:${asset.id}`]);
  assert.equal(objects.has(asset.objectKey), true);
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
            { link: "https://media.pexels.test/near.mp4", file_type: "video/mp4", width: 720 }
          ]
        },
        {
          id: 2,
          url: "https://www.pexels.com/video/2",
          image: "http://insecure.example/preview.jpg",
          user: { name: "Unsafe Preview" },
          video_files: [{ link: "https://media.pexels.test/2.mp4", file_type: "video/mp4", width: 720 }]
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
    sourceUrl: "https://media.pexels.test/near.mp4",
    contentType: "video/mp4"
  }]);
});
