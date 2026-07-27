import { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresProjectRepository } from "./domain.js";
import { PexelsClient, PostgresMediaRepository, PrivateObjectStore } from "./media-storage.js";
import { PostgresRenderRepository } from "./render-repository.js";
import { createApp, createTestApp } from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const pool = new pg.Pool({ connectionString: required("DATABASE_URL") });
const objectStore = new PrivateObjectStore(new S3Client({
  region: process.env.R2_REGION ?? "auto",
  endpoint: required("R2_ENDPOINT"),
  forcePathStyle: true,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY")
  }
}), required("R2_BUCKET"));

const projects = new PostgresProjectRepository(pool);
const renders = new PostgresRenderRepository(pool);
const media = {
  repository: new PostgresMediaRepository(pool),
  store: objectStore,
  pexels: new PexelsClient(required("PEXELS_API_KEY")),
  enqueueInspection: async (assetId: string, ownerId: string, projectId: string) => {
    await pool.query(
      `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
       VALUES ($1, 'inspect-media', $2, $3)
       ON CONFLICT ("dedupeKey") DO NOTHING`,
      [randomUUID(), `inspect-media:${assetId}`, { assetId, ownerId, projectId }]
    );
  }
};

const port = Number(process.env.PORT ?? 3000);

if (process.env.FMOTION_LOCAL_AUTH === "1") {
  // ponytail: local-only identity inject. Ceiling: single fixed owner. Upgrade: real Supabase JWT.
  const ownerId = "local-dev";
  await pool.query(
    `INSERT INTO "User" (id, state) VALUES ($1, 'active')
     ON CONFLICT (id) DO UPDATE SET state = 'active'`,
    [ownerId]
  );
  createTestApp({ ownerId, projects, renders, media }).listen(port);
} else {
  createApp({
    projects,
    renders,
    media,
    authConfig: {
      issuer: required("SUPABASE_ISSUER"),
      audience: required("SUPABASE_AUDIENCE"),
      jwksUrl: new URL(required("SUPABASE_JWKS_URL"))
    },
    accountState: async (ownerId) => {
      const result = await pool.query<{ state: string }>(
        `SELECT state FROM "User" WHERE id = $1`,
        [ownerId]
      );
      return result.rows[0]?.state;
    }
  }).listen(port);
}
