import { S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { credentialVaultFromEnv, falByokEnabled, setFalDiagnosticSink } from "@f-engine/fal-host";
import {
  createQueueHandlers,
  mediaLimitsFromEnv,
  S3WorkerObjectStore
} from "./runtime.js";
import {
  guardDatabasePool,
  outboxRetentionHoursFromEnv,
  startQueueRuntime,
  workerDatabaseIdleTimeoutMillis,
  workerDatabasePoolMax
} from "./queue.js";

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
// Queue diagnostics for this process. The fal-host sink redacts keys and signed URLs.
setFalDiagnosticSink((event) => {
  console.error("fal diagnostic", JSON.stringify(event));
});
const pool = guardDatabasePool(new pg.Pool({
  connectionString,
  max: workerDatabasePoolMax,
  idleTimeoutMillis: workerDatabaseIdleTimeoutMillis
}));
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
