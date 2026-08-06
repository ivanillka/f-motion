-- Machine API keys and host usage ledger (free grant → paid). Not FAL credits.

CREATE TABLE "ApiKey" (
  id TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL,
  hint TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'default',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ApiKey_hint_length_check" CHECK (char_length(hint) BETWEEN 1 AND 4),
  CONSTRAINT "ApiKey_label_length_check" CHECK (char_length(label) BETWEEN 1 AND 64)
);

CREATE UNIQUE INDEX "ApiKey_tokenHash_active_uidx"
  ON "ApiKey" ("tokenHash")
  WHERE "revokedAt" IS NULL;

CREATE INDEX "ApiKey_ownerId_idx" ON "ApiKey" ("ownerId");

CREATE TABLE "UsageBalance" (
  "ownerId" TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageBalance_nonneg" CHECK (balance >= 0)
);

CREATE TABLE "UsageLedger" (
  id TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageLedger_reason_check" CHECK (
    reason IN ('free_grant', 'render_preview', 'render_final', 'top_up')
  ),
  UNIQUE ("ownerId", "idempotencyKey")
);

CREATE INDEX "UsageLedger_ownerId_idx" ON "UsageLedger" ("ownerId");
