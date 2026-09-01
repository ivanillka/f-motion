import test from "node:test";
import assert from "node:assert/strict";
import { defaultVideoArchitecture, resolveSceneMediaIntent, sceneMediaIntent, setMediaIntentAdapter } from "@f-engine/reel-engine";
import { registerMediaIntentAdapter } from "../src/media-intent-adapter.ts";

test("registerMediaIntentAdapter merges structure cues into stock queries", async () => {
  setMediaIntentAdapter(undefined);
  registerMediaIntentAdapter();
  const input = {
    brief: "Quiet harbor at dawn",
    architecture: { ...defaultVideoArchitecture, structure: "mystery" }
  };
  const adapted = await resolveSceneMediaIntent(input, sceneMediaIntent);
  const plain = sceneMediaIntent({
    ...input,
    architecture: { ...defaultVideoArchitecture, structure: "story_arc" }
  });
  assert.ok(adapted.stock_queries.length >= plain.stock_queries.length);
  assert.notDeepEqual(adapted.stock_queries, plain.stock_queries);
});
