CREATE TABLE "RenderEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "RenderJob"("id") ON DELETE CASCADE,
  "phase" TEXT NOT NULL,
  "percent" INTEGER NOT NULL CHECK ("percent" >= 0 AND "percent" <= 100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "RenderEvent_jobId_id_idx" ON "RenderEvent" ("jobId", "id");
