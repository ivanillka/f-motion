import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { credentialVaultFromEnv, falByokEnabled } from "@f-engine/fal-host";
import {
  createQueueHandlers,
  mediaLimitsFromEnv,
  S3WorkerObjectStore
} from "./runtime.js";
import { outboxRetentionHoursFromEnv, startQueueRuntime } from "./queue.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const connectionString = process.env.QUEUE_DATABASE_URL?.trim() || required("DATABASE_URL");
const mediaLimits = mediaLimitsFromEnv(process.env);
const outboxRetentionHours = outboxRetentionHoursFromEnv(process.env);
if (falByokEnabled(process.env)) {
  // Worker decrypts owner FAL credentials for generate-fal-image / video / speech. Same KEK as API.
  credentialVaultFromEnv(process.env);
}
const pool = new pg.Pool({ connectionString });
const store = new S3WorkerObjectStore(new S3Client({
  region: process.env.R2_REGION ?? "auto",
  endpoint: required("R2_ENDPOINT"),
  forcePathStyle: true,
  credentials: {
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY")
  }
}), required("R2_BUCKET"), mediaLimits.probeTimeoutMs);

await startQueueRuntime(
  connectionString,
  createQueueHandlers(pool, store, undefined, mediaLimits, process.env),
  pool,
  outboxRetentionHours
);
