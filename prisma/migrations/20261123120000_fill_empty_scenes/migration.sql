-- Studio fills the scenes an owner left empty from their own ready media.
-- createdAt gives that fill a stable order: the earliest uploads first.
ALTER TABLE "MediaAsset" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Civitai videos stay out of Studio auto-fill until the owner opts in.
ALTER TABLE "CivitaiOwnerSettings" ADD COLUMN "videosInAutoFill" BOOLEAN NOT NULL DEFAULT false;
