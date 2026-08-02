import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { accessPolicyFromEnv } from "./access-policy.js";
import { externalImportConfigFromEnv } from "./external-import.js";
import { PostgresProjectRepository } from "./domain.js";
import { assertLocalAuthAllowed } from "./local-auth.js";
import { PostgresMediaRepository, PrivateObjectStore } from "./media-storage.js";
import { PostgresRenderRepository, renderProfilesFromEnv } from "./render-repository.js";
import { createApp, createTestApp } from "./server.js";
import {
  assertNoSharedFalCredential,
  assertNoSharedPexelsCredential,
  credentialVaultFromEnv,
  falByokEnabled
} from "@f-engine/fal-host";
import { PostgresFalCredentialService } from "./fal-credentials.js";
import { PostgresFalGenerationService } from "./fal-generation.js";
import {
  PexelsProviderError,
  PostgresPexelsCredentialService,
  pexelsByokEnabled
} from "./pexels-credentials.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

assertLocalAuthAllowed(process.env);
assertNoSharedFalCredential(process.env);
assertNoSharedPexelsCredential(process.env);
const accessPolicy = accessPolicyFromEnv(process.env);
const externalImports = externalImportConfigFromEnv(process.env);

const pool = new pg.Pool({ connectionString: required("DATABASE_URL") });
// pg.Pool emits "error" for idle-client connection drops (DB restart, network
// blip); without a listener that is an unhandled exception that kills the
// whole process. Log it and let the next /readyz check report 503 instead.
pool.on("error", (error) => {
  console.error("postgres pool idle client error", error);
});
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
const renders = new PostgresRenderRepository(pool, renderProfilesFromEnv(process.env));
const falEnabled = falByokEnabled(process.env);
const pexelsEnabled = pexelsByokEnabled(process.env);
const credentialVault = falEnabled || pexelsEnabled ? credentialVaultFromEnv(process.env) : undefined;
const falCredentials = falEnabled
  ? new PostgresFalCredentialService(pool, credentialVault!)
  : undefined;
const falGeneration = falCredentials
  ? new PostgresFalGenerationService(pool, falCredentials)
  : undefined;
const pexelsCredentials = pexelsEnabled
  ? new PostgresPexelsCredentialService(pool, credentialVault!)
  : undefined;
const media = {
  repository: new PostgresMediaRepository(pool),
  store: objectStore,
  pexelsForOwner: async (ownerId: string) => {
    if (!pexelsCredentials) throw new PexelsProviderError("unavailable");
    return pexelsCredentials.client(ownerId);
  }
};

const port = Number(process.env.PORT ?? 3000);

const ready = async () => {
  await pool.query("SELECT 1");
  return true;
};

if (process.env.FENGINE_LOCAL_AUTH === "1") {
  // ponytail: local-only identity inject. Ceiling: single fixed owner. Upgrade: real Supabase JWT.
  const ownerId = "local-dev";
  await pool.query(
    `INSERT INTO "User" (id, state) VALUES ($1, 'active')
     ON CONFLICT (id) DO UPDATE SET state = 'active'`,
    [ownerId]
  );
  createTestApp({ ownerId, projects, renders, media, ready, falCredentials, falGeneration, pexelsCredentials }).listen(port);
} else {
  createApp({
    projects,
    renders,
    media,
    falCredentials,
    falGeneration,
    pexelsCredentials,
    ready,
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
    },
    ensureUser: async (ownerId) => {
      await pool.query(
        `INSERT INTO "User" (id, state) VALUES ($1, 'active') ON CONFLICT (id) DO NOTHING`,
        [ownerId]
      );
    },
    accessPolicy,
    externalImports
  }).listen(port);
}
