-- Postgres rejects using a newly added enum value in the same transaction.
-- Commit this ADD VALUE first; the CHECK/FK that names image_to_video is
-- 20260802190100_fal_image_to_video_source.
ALTER TYPE "GenerationKind" ADD VALUE 'image_to_video';
