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
  GetObjectCommand,
  HeadObjectCommand,
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

test("worker probes stored media and renders an immutable project result", async (context) => {
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
      "../../../prisma/migrations/20260726002000_render_events/migration.sql",
      "../../../prisma/migrations/20260731000000_render_job_input/migration.sql",
      "../../../prisma/migrations/20260731000000_seal_inspected_media/migration.sql",
      "../../../prisma/migrations/20260801000000_coalesce_render_jobs/migration.sql"
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
        (id, "ownerId", "projectId", "quarantineObjectKey", state, "declaredType", "maxBytes")
       VALUES ('asset', 'owner', 'project', 'projects/project/media-quarantine/asset', 'inspecting', 'video/mp4', $1),
              ('race', 'owner', 'project', 'projects/project/media-quarantine/race', 'inspecting', 'video/mp4', $1),
              ('fake', 'owner', 'project', 'projects/project/media-quarantine/fake', 'inspecting', 'video/mp4', 100)`
      ,
      [mp4.length]
    );
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "projects/project/media-quarantine/asset",
      Body: mp4,
      ContentType: "video/mp4"
    }));
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "projects/project/media-quarantine/race",
      Body: mp4,
      ContentType: "video/mp4"
    }));
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "projects/project/media-quarantine/fake",
      Body: "fixture",
      ContentType: "video/mp4"
    }));
    await pool.query(
      `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, "renderInput", state)
       VALUES ('job', 'owner', 'project', 0, $1, 'queued'),
              ('cancelled-job', 'owner', 'project', 0, $1, 'cancelled')`,
      [{
        schema_version: 1,
        id: "project",
        owner_id: "owner",
        revision: 0,
        brief: { purpose: "Worker", audience: "Teams", tone: "Warm" },
        scenes: [scene]
      }]
    );
    await pool.query(
      `UPDATE "Project" SET revision = 1 WHERE id = 'project';
       UPDATE "Scene" SET payload = payload || '{"caption":"Mutable N+1 caption","media_id":"fake"}'
       WHERE id = 'scene'`
    );
    const s3Store = new S3WorkerObjectStore(s3, bucket);
    await context.test("conditional seal rejects a quarantine overwrite after inspection", async () => {
      const inspectedA = await s3Store.inspect(
        "projects/project/media-quarantine/race",
        mp4.length
      );
      assert.ok(inspectedA.identity);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: "projects/project/media-quarantine/race",
        Body: "replacement B",
        ContentType: "video/mp4"
      }));
      await assert.rejects(
        () => s3Store.seal(
          "projects/project/media-quarantine/race",
          "projects/project/media-sealed/race",
          inspectedA.identity
        ),
        (error) => error?.$metadata?.httpStatusCode === 412
      );
      await assert.rejects(
        () => s3.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: "projects/project/media-sealed/race"
        })),
        (error) => error?.$metadata?.httpStatusCode === 404
      );
      assert.deepEqual((await pool.query(
        `SELECT state, "sealedObjectKey", "sealedEtag", "sealedSha256"
           FROM "MediaAsset" WHERE id = 'race'`
      )).rows[0], {
        state: "inspecting",
        sealedObjectKey: null,
        sealedEtag: null,
        sealedSha256: null
      });
    });

    const downloaded = [];
    const handlers = createQueueHandlers(pool, {
      inspect: (...args) => s3Store.inspect(...args),
      seal: (...args) => s3Store.seal(...args),
      async downloadSealed(...args) {
        downloaded.push(args[0]);
        return s3Store.downloadSealed(...args);
      },
      put: (...args) => s3Store.put(...args),
      delete: (...args) => s3Store.delete(...args)
    }, { width: 720, height: 1280, watermark: "Reference preview" });
    assert.deepEqual(await handlers.inspect({
      assetId: "asset",
      ownerId: "owner",
      projectId: "project"
    }, new AbortController().signal), { state: "ready" });
    const sealed = (await pool.query(
      `SELECT state, "sealedObjectKey", "sealedEtag", "sealedSha256"
         FROM "MediaAsset" WHERE id = 'asset'`
    )).rows[0];
    assert.equal(sealed.state, "ready");
    assert.equal(sealed.sealedObjectKey, "projects/project/media-sealed/asset");
    assert.ok(sealed.sealedEtag);
    assert.match(sealed.sealedSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(await handlers.inspect({
      assetId: "asset",
      ownerId: "owner",
      projectId: "project"
    }, new AbortController().signal), { state: "ready" });

    // A still-valid direct upload can recreate/overwrite quarantine, but render
    // remains bound to the independently sealed bytes inspected above.
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: "projects/project/media-quarantine/asset",
      Body: "replacement B",
      ContentType: "video/mp4"
    }));
    const sealedBody = await s3.send(new GetObjectCommand({
      Bucket: bucket,
      Key: "projects/project/media-sealed/asset"
    }));
    assert.deepEqual(
      Buffer.from(await sealedBody.Body.transformToByteArray()),
      mp4
    );
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
    const frozen = (await pool.query(`SELECT "renderInput" FROM "RenderJob" WHERE id = 'job'`)).rows[0].renderInput;
    assert.equal(frozen.revision, 0);
    assert.equal(frozen.scenes[0].caption, "Rendered project caption");
    assert.equal(frozen.scenes[0].media_id, "asset");
    assert.equal(frozen.scenes[0].order, 0);
    assert.deepEqual(downloaded, ["projects/project/media-sealed/asset"]);
    assert.deepEqual(await handlers.render({
      jobId: "cancelled-job",
      ownerId: "owner",
      projectId: "project",
      revision: 0
    }, new AbortController().signal), { state: "cancelled" });

    const snapshot = {
      schema_version: 1,
      id: "project",
      owner_id: "owner",
      revision: 1,
      brief: { purpose: "Worker", audience: "Teams", tone: "Warm" },
      scenes: [scene]
    };
    await pool.query(
      `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, "renderInput", state)
       VALUES ('race-job', 'owner', 'project', 1, $1, 'queued')`,
      [snapshot]
    );
    const uploaded = [];
    const removed = [];
    let releaseUploads;
    const bothUploaded = new Promise((resolve) => { releaseUploads = resolve; });
    const raceHandlers = createQueueHandlers(pool, {
      inspect: (...args) => s3Store.inspect(...args),
      seal: (...args) => s3Store.seal(...args),
      downloadSealed: (...args) => s3Store.downloadSealed(...args),
      async put(...args) {
        await s3Store.put(...args);
        uploaded.push(args[0]);
        if (uploaded.length === 2) releaseUploads();
        await bothUploaded;
      },
      async delete(objectKey) {
        removed.push(objectKey);
        await s3Store.delete(objectKey);
      }
    }, { width: 720, height: 1280, watermark: "Reference preview" });
    const duplicateDeliveries = await Promise.all([
      raceHandlers.render({ jobId: "race-job", ownerId: "owner", projectId: "project", revision: 1 }, new AbortController().signal),
      raceHandlers.render({ jobId: "race-job", ownerId: "owner", projectId: "project", revision: 1 }, new AbortController().signal)
    ]);
    assert.deepEqual(duplicateDeliveries.map(({ state }) => state).sort(), ["cancelled", "complete"]);
    assert.equal(new Set(uploaded).size, 2, "duplicate deliveries use distinct attempt keys");
    assert.equal(removed.length, 1, "the losing upload is removed");
    const raceResult = (await pool.query(
      `SELECT "objectKey" FROM "RenderResult" WHERE "jobId" = 'race-job'`
    )).rows[0];
    assert.ok(raceResult.objectKey.includes("/race-job/"));
    assert.equal(uploaded.includes(raceResult.objectKey), true);
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: raceResult.objectKey }));

    await pool.query(
      `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, "renderInput", state)
       VALUES ('failed-attempt', 'owner', 'project', 2, $1, 'failed'),
              ('retry-job', 'owner', 'project', 2, $1, 'queued')`,
      [{ ...snapshot, revision: 2 }]
    );
    assert.equal((await handlers.render({
      jobId: "retry-job",
      ownerId: "owner",
      projectId: "project",
      revision: 2
    }, new AbortController().signal)).state, "complete");

    await pool.query(
      `INSERT INTO "RenderJob" (id, "ownerId", "projectId", revision, "renderInput", state)
       VALUES ('cancel-during-upload', 'owner', 'project', 3, $1, 'queued')`,
      [{ ...snapshot, revision: 3 }]
    );
    const cancelledUploads = [];
    const cancelledRemovals = [];
    const cancellationHandlers = createQueueHandlers(pool, {
      inspect: (...args) => s3Store.inspect(...args),
      seal: (...args) => s3Store.seal(...args),
      downloadSealed: (...args) => s3Store.downloadSealed(...args),
      async put(...args) {
        await s3Store.put(...args);
        cancelledUploads.push(args[0]);
        await pool.query(`UPDATE "RenderJob" SET state = 'cancelled' WHERE id = 'cancel-during-upload'`);
      },
      async delete(objectKey) {
        cancelledRemovals.push(objectKey);
        await s3Store.delete(objectKey);
      }
    }, { width: 720, height: 1280, watermark: "Reference preview" });
    assert.deepEqual(await cancellationHandlers.render({
      jobId: "cancel-during-upload",
      ownerId: "owner",
      projectId: "project",
      revision: 3
    }, new AbortController().signal), { state: "cancelled" });
    assert.deepEqual(cancelledRemovals, cancelledUploads);
    assert.equal(Number((await pool.query(
      `SELECT COUNT(*) AS count FROM "RenderResult" WHERE "jobId" = 'cancel-during-upload'`
    )).rows[0].count), 0);
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
