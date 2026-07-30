import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import pg from "pg";
import { createQueueHandlers, S3WorkerObjectStore } from "../dist/runtime.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const databaseUrl = process.env.TEST_DATABASE_URL;
const endpoint = process.env.TEST_S3_ENDPOINT;
if (!databaseUrl || !endpoint) throw new Error("worker integration configuration is required");

test("worker probes stored media and renders an immutable project result", async () => {
  const schema = `worker_test_${randomUUID().replaceAll("-", "_")}`;
  const bucket = `fengine-${randomUUID()}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: "fengine", secretAccessKey: "fengine-local-secret" }
  });
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  try {
    for (const path of [
      "../../../prisma/migrations/20260726000000_initial/migration.sql",
      "../../../prisma/migrations/20260726001000_media_admission/migration.sql",
      "../../../prisma/migrations/20260726002000_render_events/migration.sql"
    ]) {
      await pool.query(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    await pool.query(`INSERT INTO "User" (id, state) VALUES ('owner', 'active')`);
    await pool.query(
      `INSERT INTO "Project" (id, "ownerId", revision, brief)
       VALUES ('project', 'owner', 0, '{"purpose":"Worker","audience":"Teams","tone":"Warm"}')`
    );
    const scene = {
      id: "scene",
      order: 0,
      caption: "Rendered project caption",
      duration_ms: 500,
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "none",
      audio_level: 1,
      ducking: false,
      media_id: "asset"
    };
    await pool.query(
      `INSERT INTO "Scene" (id, "projectId", position, payload) VALUES ('scene', 'project', 0, $1)`,
      [scene]
    );
    const mp4 = await readFile(join(fixtures, "scene_one.mp4"));
    await pool.query(
      `INSERT INTO "MediaAsset"
        (id, "ownerId", "projectId", "objectKey", state, "declaredType", "maxBytes")
       VALUES ('asset', 'owner', 'project', 'projects/project/media/asset', 'inspecting', 'video/mp4', $1),
              ('fake', 'owner', 'project', 'projects/project/media/fake', 'inspecting', 'video/mp4', 100)`
      ,
      [mp4.length]
    );
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "projects/project/media/asset",
      Body: mp4,
      ContentType: "video/mp4"
    }));
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "projects/project/media/fake",
      Body: "fixture",
      ContentType: "video/mp4"
    }));
    await pool.query(
      `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, state)
       VALUES ('job', 'owner', 'project', 0, 'queued'),
              ('cancelled-job', 'owner', 'project', 0, 'cancelled')`
    );
    const handlers = createQueueHandlers(
      pool,
      new S3WorkerObjectStore(s3, bucket),
      { width: 720, height: 1280, watermark: "Reference preview" }
    );
    assert.deepEqual(await handlers.inspect({
      assetId: "asset",
      ownerId: "owner",
      projectId: "project"
    }, new AbortController().signal), { state: "ready" });
    assert.equal((await pool.query(`SELECT state FROM "MediaAsset" WHERE id = 'asset'`)).rows[0].state, "ready");
    assert.deepEqual(await handlers.inspect({
      assetId: "fake",
      ownerId: "owner",
      projectId: "project"
    }, new AbortController().signal), { state: "quarantined" });

    const rendered = await handlers.render({
      jobId: "job",
      ownerId: "owner",
      projectId: "project",
      revision: 0
    }, new AbortController().signal);
    assert.equal(rendered.state, "complete");
    assert.equal((await pool.query(`SELECT state FROM "RenderJob" WHERE id = 'job'`)).rows[0].state, "complete");
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS count FROM "RenderResult" WHERE "jobId" = 'job'`)).rows[0].count), 1);
    assert.deepEqual(await handlers.render({
      jobId: "cancelled-job",
      ownerId: "owner",
      projectId: "project",
      revision: 0
    }, new AbortController().signal), { state: "cancelled" });
  } finally {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    if (listed.Contents?.length) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: listed.Contents.map(({ Key }) => ({ Key })) }
      }));
    }
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
