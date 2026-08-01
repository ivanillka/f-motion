-- A second historical completed result needs an explicit result-selection
-- decision rather than an arbitrary migration winner.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "RenderJob"
     WHERE state = 'complete'
     GROUP BY "ownerId", "projectId", revision
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple completed renders exist for one project revision';
  END IF;
END $$;

-- Preserve one completed/running/queued canonical attempt and retain redundant
-- historical work as cancelled rows. The worker ignores any already-dispatched
-- duplicate because cancellation is checked before rendering and upload.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "ownerId", "projectId", revision
           ORDER BY CASE state
             WHEN 'complete' THEN 0
             WHEN 'running' THEN 1
             ELSE 2
           END, id
         ) AS position
    FROM "RenderJob"
   WHERE state IN ('queued', 'running', 'complete')
), cancelled AS (
  UPDATE "RenderJob" AS job
     SET state = 'cancelled'
    FROM ranked
   WHERE job.id = ranked.id
     AND ranked.position > 1
     AND job.state IN ('queued', 'running')
  RETURNING job.id
)
INSERT INTO "RenderEvent" ("jobId", phase, percent)
SELECT id, 'cancelled', 0 FROM cancelled;

-- One unchanged project revision has one canonical render. Failed and cancelled
-- attempts remain as history and may be retried.
CREATE UNIQUE INDEX "RenderJob_canonical_revision_key"
  ON "RenderJob" ("ownerId", "projectId", revision)
  WHERE state IN ('queued', 'running', 'complete');
