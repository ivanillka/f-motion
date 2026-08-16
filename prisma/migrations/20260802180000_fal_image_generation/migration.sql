-- CreateEnum
CREATE TYPE "GenerationKind" AS ENUM ('image');

-- CreateEnum
CREATE TYPE "GenerationState" AS ENUM (
  'quoted',
  'queued',
  'submitting',
  'running',
  'downloading',
  'inspecting',
  'ready',
  'cancelled',
  'failed',
  'submission_uncertain'
);

-- CreateTable
CREATE TABLE "GenerationJob" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sceneId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "kind" "GenerationKind" NOT NULL DEFAULT 'image',
  "endpointId" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "inputJson" JSONB NOT NULL,
  "quoteJson" JSONB NOT NULL,
  "quoteExpiresAt" TIMESTAMP(3) NOT NULL,
  "state" "GenerationState" NOT NULL DEFAULT 'quoted',
  "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  "providerRequestId" TEXT,
  "resultMediaId" TEXT,
  "failureCode" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GenerationJob_endpoint_kind_check" CHECK (
    ("kind" = 'image' AND "endpointId" = 'fal-ai/flux/schnell')
  ),
  CONSTRAINT "GenerationJob_prompt_bounds_check" CHECK (
    char_length("prompt") BETWEEN 1 AND 500
  )
);

CREATE UNIQUE INDEX "GenerationJob_ownerId_projectId_idempotencyKey_key"
  ON "GenerationJob"("ownerId", "projectId", "idempotencyKey");

CREATE INDEX "GenerationJob_ownerId_projectId_sceneId_idx"
  ON "GenerationJob"("ownerId", "projectId", "sceneId");

CREATE INDEX "GenerationJob_ownerId_state_idx"
  ON "GenerationJob"("ownerId", "state");

CREATE INDEX "GenerationJob_state_updatedAt_idx"
  ON "GenerationJob"("state", "updatedAt");

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "ProviderCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_resultMediaId_fkey"
  FOREIGN KEY ("resultMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
