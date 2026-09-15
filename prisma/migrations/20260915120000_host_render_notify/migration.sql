ALTER TABLE "Project"
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "notifyUrl" TEXT;

CREATE UNIQUE INDEX "Project_ownerId_externalId_key"
  ON "Project" ("ownerId", "externalId");

ALTER TABLE "RenderJob"
  ADD COLUMN "notifyUrl" TEXT,
  ADD COLUMN "externalId" TEXT;
