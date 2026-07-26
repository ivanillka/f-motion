ALTER TABLE "MediaAsset"
  ADD COLUMN "declaredType" TEXT NOT NULL,
  ADD COLUMN "maxBytes" INTEGER NOT NULL;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_maxBytes_check"
  CHECK ("maxBytes" > 0 AND "maxBytes" <= 100000000);

CREATE TABLE "WorkOutbox" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL UNIQUE,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3)
);
