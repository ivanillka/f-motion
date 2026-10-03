-- One revision can render reel and desktop as two cover crops.
DROP INDEX IF EXISTS "RenderJob_canonical_revision_kind_key";
CREATE UNIQUE INDEX "RenderJob_canonical_revision_kind_frame_key"
  ON "RenderJob" (
    "ownerId",
    "projectId",
    revision,
    kind,
    (("renderProfile"->>'width')::int),
    (("renderProfile"->>'height')::int)
  )
  WHERE state IN ('queued', 'running', 'complete');
