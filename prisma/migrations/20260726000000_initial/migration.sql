CREATE TYPE "AccountState" AS ENUM ('active', 'suspended', 'deletion_pending');
CREATE TYPE "MediaState" AS ENUM ('admitted', 'inspecting', 'ready', 'quarantined', 'rejected');
CREATE TYPE "RenderState" AS ENUM ('queued', 'running', 'cancelled', 'complete', 'failed');

CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "state" "AccountState" NOT NULL DEFAULT 'active', "acceptedPolicyVersion" TEXT);
CREATE TABLE "Project" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "revision" INTEGER NOT NULL DEFAULT 0, "brief" JSONB NOT NULL, UNIQUE ("ownerId", "id"));
CREATE TABLE "Concept" ("id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE, "position" INTEGER NOT NULL, "title" TEXT NOT NULL, "treatment" TEXT NOT NULL, "selected" BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE ("projectId", "position"));
CREATE UNIQUE INDEX "Concept_one_selected_per_project" ON "Concept" ("projectId") WHERE "selected";
CREATE TABLE "Scene" ("id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE, "position" INTEGER NOT NULL, "payload" JSONB NOT NULL, UNIQUE ("projectId", "position"));
CREATE TABLE "MediaAsset" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE, "objectKey" TEXT NOT NULL UNIQUE, "state" "MediaState" NOT NULL DEFAULT 'admitted', "detected" JSONB, "attribution" JSONB, UNIQUE ("ownerId", "projectId", "id"));
CREATE TABLE "CommandReceipt" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE, "commandId" TEXT NOT NULL, "baseRevision" INTEGER NOT NULL, "result" JSONB NOT NULL, UNIQUE ("ownerId", "projectId", "commandId"));
CREATE TABLE "RenderJob" ("id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE, "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE, "revision" INTEGER NOT NULL, "state" "RenderState" NOT NULL DEFAULT 'queued', UNIQUE ("ownerId", "projectId", "id"));
CREATE TABLE "RenderResult" ("id" TEXT PRIMARY KEY, "jobId" TEXT NOT NULL UNIQUE REFERENCES "RenderJob"("id") ON DELETE CASCADE, "objectKey" TEXT NOT NULL UNIQUE, "metadata" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");
