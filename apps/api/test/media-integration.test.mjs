import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client
} from "@aws-sdk/client-s3";
import pg from "pg";
import { PostgresProjectRepository } from "../dist/domain.js";
import { PexelsClient, PostgresMediaRepository, PrivateObjectStore } from "../dist/media-storage.js";
import { createTestApp } from "../dist/server.js";

const enabled = process.env.RUN_MEDIA_INTEGRATION === "1";
const integration = enabled ? test : test.skip;

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

integration("authenticated media routes use real PostgreSQL and private S3 storage", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const endpoint = process.env.TEST_S3_ENDPOINT;
  if (!databaseUrl || !endpoint) throw new Error("media integration configuration is required");
  const schema = `media_test_${randomUUID().replaceAll("-", "_")}`;
  const bucket = `fmotion-${randomUUID()}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const client = new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: "fmotion", secretAccessKey: "fmotion-local-secret" }
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  const server = createServer();
  try {
    for (const path of [
      "../../../prisma/migrations/20260726000000_initial/migration.sql",
      "../../../prisma/migrations/20260726001000_media_admission/migration.sql"
    ]) {
      await pool.query(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    await pool.query(`INSERT INTO "User" (id, state) VALUES ('owner', 'active'), ('other', 'active')`);
    const projects = new PostgresProjectRepository(pool);
    const project = await projects.create("owner", { purpose: "Media", audience: "Teams", tone: "Warm" });
    const repository = new PostgresMediaRepository(pool);
    const store = new PrivateObjectStore(client, bucket);
    const pexelsRequest = async (url) => {
      if (String(url).startsWith("https://api.pexels.com/")) {
        return new Response(JSON.stringify({
          videos: [{
            id: 42,
            url: "https://www.pexels.com/video/42",
            user: { name: "Fixture Creator" },
            video_files: [{ link: "https://media.pexels.test/42.mp4", file_type: "video/mp4", width: 720 }]
          }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(new Uint8Array([0, 1, 2, 3]), { status: 200 });
    };
    const enqueued = [];
    server.on("request", createTestApp({
      ownerId: "owner",
      projects,
      media: {
        repository,
        store,
        pexels: new PexelsClient("server-only-key", pexelsRequest),
        enqueueInspection: async (assetId) => { enqueued.push(assetId); }
      }
    }));
    const origin = await listen(server);

    const admissionResponse = await fetch(`${origin}/api/projects/${project.id}/media/uploads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content_type: "video/mp4", bytes: 7 })
    });
    assert.equal(admissionResponse.status, 201);
    const admission = await admissionResponse.json();
    assert.equal(admission.method, "PUT");
    assert.match(admission.upload_url, /X-Amz-Signature=/i);
    assert.equal((await fetch(admission.upload_url, {
      method: "PUT",
      headers: { "content-type": "video/mp4" },
      body: "fixture"
    })).ok, true);
    assert.equal(await repository.get("other", project.id, admission.asset_id), undefined);

    const complete = await fetch(`${origin}/api/projects/${project.id}/media/${admission.asset_id}/complete`, {
      method: "POST"
    });
    assert.equal(complete.status, 202);
    assert.deepEqual(enqueued, [admission.asset_id]);
    assert.equal((await repository.recordInspection("owner", project.id, admission.asset_id, {
      type: "image/png",
      bytes: 7
    }))?.state, "quarantined");

    const search = await (await fetch(`${origin}/api/pexels/search?q=teams`)).json();
    assert.equal(search.results[0].creator, "Fixture Creator");
    assert.equal("sourceUrl" in search.results[0], false);
    const copied = await fetch(`${origin}/api/projects/${project.id}/media/pexels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "teams", pexels_id: 42 })
    });
    assert.equal(copied.status, 201);
    const copiedAsset = (await copied.json()).asset;
    assert.equal(copiedAsset.attribution.source, "Pexels");
    assert.equal(copiedAsset.attribution.creator, "Fixture Creator");
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    if (listed.Contents?.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: listed.Contents.map(({ Key }) => ({ Key })) }
      }));
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
