-- Uses GenerationKind.image_to_video after 20260802190000 committed it.
ALTER TABLE "GenerationJob" ADD COLUMN "sourceMediaId" TEXT;

ALTER TABLE "GenerationJob" DROP CONSTRAINT "GenerationJob_endpoint_kind_check";

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_endpoint_kind_check" CHECK (
    ("kind" = 'image' AND "endpointId" = 'fal-ai/flux/schnell')
    OR ("kind" = 'image_to_video' AND "endpointId" = 'fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video')
  );

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_sourceMediaId_fkey"
  FOREIGN KEY ("sourceMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
