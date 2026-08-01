-- Rollout contract: pause admission and drain workers before this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RenderJob" WHERE state IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'render jobs must be drained before adding immutable profiles';
  END IF;
END $$;

CREATE TYPE "RenderKind" AS ENUM ('preview', 'final');
ALTER TABLE "RenderJob"
  ADD COLUMN kind "RenderKind" NOT NULL DEFAULT 'preview',
  ADD COLUMN "renderProfile" JSONB;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "RenderJob" job
      JOIN "RenderResult" result ON result."jobId" = job.id
     WHERE job.state = 'complete'
       AND (jsonb_typeof(result.metadata->'width') IS DISTINCT FROM 'number'
         OR jsonb_typeof(result.metadata->'height') IS DISTINCT FROM 'number'
         OR (result.metadata->>'width')::numeric < 16
         OR (result.metadata->>'height')::numeric < 16)
  ) OR EXISTS (
    SELECT 1 FROM "RenderJob" job
     WHERE job.state = 'complete'
       AND NOT EXISTS (SELECT 1 FROM "RenderResult" result WHERE result."jobId" = job.id)
  ) THEN
    RAISE EXCEPTION 'completed render metadata lacks a valid width or height';
  END IF;
END $$;

UPDATE "RenderJob" job
   SET "renderProfile" = jsonb_build_object(
     'width', (result.metadata->>'width')::integer,
     'height', (result.metadata->>'height')::integer
   ) || CASE
     WHEN jsonb_typeof(result.metadata->'watermark') = 'string'
       THEN jsonb_build_object('watermark', result.metadata->>'watermark')
     ELSE '{}'::jsonb
   END
  FROM "RenderResult" result
 WHERE result."jobId" = job.id AND job.state = 'complete';

-- These terminal rows can never render; 16x16 is an explicit neutral tombstone,
-- not a claim about output that does not exist.
UPDATE "RenderJob"
   SET "renderProfile" = '{"width":16,"height":16}'::jsonb
 WHERE state IN ('cancelled', 'failed') AND "renderProfile" IS NULL;

ALTER TABLE "RenderJob" ALTER COLUMN "renderProfile" SET NOT NULL;
DROP INDEX "RenderJob_canonical_revision_key";
CREATE UNIQUE INDEX "RenderJob_canonical_revision_kind_key"
  ON "RenderJob" ("ownerId", "projectId", revision, kind)
  WHERE state IN ('queued', 'running', 'complete');
