ALTER TABLE "RenderJob" ADD COLUMN "renderInput" JSONB;

-- Only an unchanged project can safely represent the revision recorded by a historical job.
UPDATE "RenderJob" AS job
SET "renderInput" = jsonb_build_object(
  'schema_version', 1,
  'id', project.id,
  'owner_id', project."ownerId",
  'revision', project.revision,
  'brief', project.brief,
  'scenes', COALESCE((
    SELECT jsonb_agg(scene.payload || jsonb_build_object('order', scene.position) ORDER BY scene.position)
    FROM "Scene" AS scene
    WHERE scene."projectId" = project.id
  ), '[]'::jsonb)
) || COALESCE((
  SELECT jsonb_build_object('selected_concept_id', LOWER(concept.title))
  FROM "Concept" AS concept
  WHERE concept."projectId" = project.id AND concept.selected = TRUE
  ORDER BY concept.position
  LIMIT 1
), '{}'::jsonb)
FROM "Project" AS project
WHERE project.id = job."projectId"
  AND project."ownerId" = job."ownerId"
  AND project.revision = job.revision;

-- An older revision cannot be reconstructed from mutable rows. Never relabel current content as old.
INSERT INTO "RenderEvent" ("jobId", phase, percent)
SELECT id, 'failed', 0
FROM "RenderJob"
WHERE "renderInput" IS NULL AND state IN ('queued', 'running');

UPDATE "RenderJob"
SET state = 'failed'
WHERE "renderInput" IS NULL AND state IN ('queued', 'running');

-- Keep terminal historical rows while making their unavailable input explicit and unrenderable.
UPDATE "RenderJob"
SET "renderInput" = jsonb_build_object(
  'migration_error', 'historical render input unavailable'
)
WHERE "renderInput" IS NULL;

ALTER TABLE "RenderJob" ALTER COLUMN "renderInput" SET NOT NULL;
