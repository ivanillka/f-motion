ALTER TABLE "MediaAsset" RENAME COLUMN "objectKey" TO "quarantineObjectKey";

ALTER TABLE "MediaAsset"
  ADD COLUMN "sealedObjectKey" TEXT,
  ADD COLUMN "sealedEtag" TEXT,
  ADD COLUMN "sealedVersionId" TEXT,
  ADD COLUMN "sealedSha256" TEXT,
  ADD COLUMN "inspectionEtag" TEXT,
  ADD COLUMN "inspectionVersionId" TEXT,
  ADD COLUMN "inspectionSha256" TEXT;

CREATE UNIQUE INDEX "MediaAsset_sealedObjectKey_key" ON "MediaAsset"("sealedObjectKey");

-- Existing ready rows point at client-writable keys. Requeue them rather than
-- treating mutable bytes as sealed; the worker will inspect and promote them.
UPDATE "WorkOutbox" AS outbox
   SET "dispatchedAt" = NULL, "createdAt" = CURRENT_TIMESTAMP
 WHERE outbox.kind = 'inspect-media'
   AND EXISTS (
     SELECT 1 FROM "MediaAsset" AS asset
      WHERE asset.state = 'ready'
        AND outbox."dedupeKey" = 'inspect-media:' || asset.id
   );

INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
SELECT 'seal-inspected-media:' || id,
       'inspect-media',
       'inspect-media:' || id,
       jsonb_build_object('assetId', id, 'ownerId', "ownerId", 'projectId', "projectId")
  FROM "MediaAsset"
 WHERE state = 'ready'
ON CONFLICT ("dedupeKey") DO NOTHING;

UPDATE "MediaAsset" SET state = 'inspecting' WHERE state = 'ready';

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_ready_sealed_check"
  CHECK (
    state <> 'ready' OR (
      "sealedObjectKey" IS NOT NULL
      AND "sealedObjectKey" <> "quarantineObjectKey"
      AND "sealedEtag" IS NOT NULL
      AND "sealedSha256" ~ '^[0-9a-f]{64}$'
    )
  );
