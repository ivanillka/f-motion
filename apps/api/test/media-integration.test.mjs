import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { PostgresMediaRepository, PrivateObjectStore } from "../dist/media-storage.js";

const enabled = process.env.RUN_MEDIA_INTEGRATION === "1";
const integration = enabled ? test : test.skip;

integration("owner-scoped admission/completion uses real PostgreSQL and S3-compatible storage", async () => {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const bucket = `fmotion-${randomUUID()}`;
  const client = new S3Client({
    region: "us-east-1",
    endpoint: process.env.TEST_S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: "fmotion", secretAccessKey: "fmotion-local-secret" }
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS media_integration (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL,
    object_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL
  )`);
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  const repository = new PostgresMediaRepository(pool);
  const objectKey = "projects/project-1/media/asset-1";
  await repository.insert({ id: "asset-1", ownerId: "owner-1", projectId: "project-1", objectKey, state: "admitted" });
  assert.equal(await repository.get("owner-2", "project-1", "asset-1"), undefined);
  assert.equal(await repository.markInspecting("owner-2", "project-1", "asset-1"), false);
  assert.equal(await repository.markInspecting("owner-1", "project-1", "asset-1"), true);
  const store = new PrivateObjectStore(client, bucket);
  const signed = await store.signedPut(objectKey);
  assert.match(signed, /X-Amz-Signature=/i);
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: "fixture", ContentType: "video/mp4" }));
  assert.equal(await store.exists(objectKey), true);
  await pool.query("DROP TABLE media_integration");
  await pool.end();
});
