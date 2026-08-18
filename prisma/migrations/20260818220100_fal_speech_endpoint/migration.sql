-- Uses GenerationKind.speech after 20260818220000 committed it.
ALTER TABLE "GenerationJob" DROP CONSTRAINT "GenerationJob_endpoint_kind_check";

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_endpoint_kind_check" CHECK (
    ("kind" = 'image' AND "endpointId" = 'fal-ai/flux/schnell')
    OR ("kind" = 'image_to_video' AND "endpointId" = 'fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video')
    OR ("kind" = 'speech' AND "endpointId" = 'fal-ai/kokoro/american-english')
  );

ALTER TABLE "GenerationJob" DROP CONSTRAINT "GenerationJob_prompt_bounds_check";

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_prompt_bounds_check" CHECK (
    char_length("prompt") BETWEEN 1 AND 2000
  );
