CREATE TABLE "CivitaiOwnerSettings" (
  "ownerId" TEXT NOT NULL,
  "maxNsfwLevel" TEXT NOT NULL DEFAULT 'None',
  "allowedCreators" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "minShortSide" INTEGER NOT NULL DEFAULT 1080,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CivitaiOwnerSettings_pkey" PRIMARY KEY ("ownerId"),
  CONSTRAINT "CivitaiOwnerSettings_maxNsfwLevel_check"
    CHECK ("maxNsfwLevel" IN ('None', 'Soft', 'Mature', 'X')),
  CONSTRAINT "CivitaiOwnerSettings_minShortSide_check"
    CHECK ("minShortSide" BETWEEN 480 AND 2160)
);

ALTER TABLE "CivitaiOwnerSettings"
  ADD CONSTRAINT "CivitaiOwnerSettings_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;