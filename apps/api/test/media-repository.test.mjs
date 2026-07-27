import test from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "@aws-sdk/client-s3";
import { PostgresMediaRepository, PrivateObjectStore } from "../dist/media-storage.js";

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
    credentials: { accessKeyId: "fmotion", secretAccessKey: "fmotion-secret" }
  });
  const store = new PrivateObjectStore(client, "bucket");
  const url = new URL(await store.signedPut("projects/p/media/a", "video/mp4", 4096));
  assert.match(String(url.searchParams.get("X-Amz-SignedHeaders")), /content-length/);
});
