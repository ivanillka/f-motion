import test from "node:test";
import assert from "node:assert/strict";
import { conceptsFor, applyCommand, renderPlan, cuesForScene, validateCues, coverCropFilter } from "../dist/index.js";

const snapshot = {
  schema_version: 1, id: "p1", owner_id: "u1", revision: 0,
  brief: { purpose: "Launch", audience: "Teams", tone: "Warm" },
  scenes: [{ id: "s1", order: 0, caption: "Hello", duration_ms: 1000, focal_x: .5, focal_y: .5, motion: "none", audio_level: 1, ducking: Boolean(0) }]
};

test("concept construction is deterministic and exactly three", () => {
  assert.equal(conceptsFor(snapshot.brief).length, 3);
  assert.deepEqual(conceptsFor(snapshot.brief), conceptsFor(snapshot.brief));
});
test("command increments revision exactly once", () => {
  const result = applyCommand(snapshot, { command_id: "c1", project_id: "p1", base_revision: 0, client_timestamp: "diagnostic", kind: "select_concept", payload: { concept_id: "direct" } });
  assert.equal(result.revision, 1);
});
test("stale revision is rejected", () => assert.throws(() => applyCommand(snapshot, { command_id: "c2", project_id: "p1", base_revision: 2, client_timestamp: "", kind: "select_concept", payload: { concept_id: "direct" } }), /stale/));
test("unknown commands are rejected", () => assert.throws(
  () => applyCommand(snapshot, { command_id: "c3", project_id: "p1", base_revision: 0, client_timestamp: "", kind: "delete_scene", payload: {} }),
  /unknown command/
));
test("reorder_scene moves a scene", () => {
  const twoScenes = { ...snapshot, scenes: [...snapshot.scenes, { ...snapshot.scenes[0], id: "s2", order: 1 }] };
  const result = applyCommand(twoScenes, { command_id: "c4", project_id: "p1", base_revision: 0, client_timestamp: "", kind: "reorder_scene", payload: { scene_id: "s2", to: 0 } });
  assert.deepEqual(result.scenes.map(({ id }) => id), ["s2", "s1"]);
});
test("update_scene rejects a non-object scene", () => assert.throws(
  () => applyCommand(snapshot, { command_id: "c5", project_id: "p1", base_revision: 0, client_timestamp: "", kind: "update_scene", payload: { scene: "s1" } }),
  /invalid scene/
));
test("update_scene rejects captions over 180 characters", () => assert.throws(
  () => applyCommand(snapshot, { command_id: "c6", project_id: "p1", base_revision: 0, client_timestamp: "", kind: "update_scene", payload: { scene: { ...snapshot.scenes[0], caption: "x".repeat(181) } } }),
  /caption exceeds/
));
test("render plan is 720p and watermarked", () => assert.deepEqual(renderPlan(snapshot).width, 720));

test("a short single-sentence caption derives one cue spanning the full duration", () => {
  const cues = cuesForScene(snapshot.scenes[0]);
  assert.deepEqual(cues, [{ text: "Hello", start_ms: 0, end_ms: 1000 }]);
});
test("cue derivation is deterministic for the same caption and duration", () => {
  const scene = { ...snapshot.scenes[0], caption: "First part. Second part continues here." };
  assert.deepEqual(cuesForScene(scene), cuesForScene(scene));
});
test("a multi-sentence caption derives contiguous, non-overlapping cues within the duration", () => {
  const scene = { ...snapshot.scenes[0], caption: "First part. Second part continues here.", duration_ms: 4000 };
  const cues = cuesForScene(scene);
  assert.ok(cues.length >= 2);
  assert.equal(cues[0].start_ms, 0);
  assert.equal(cues[cues.length - 1].end_ms, 4000);
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].start_ms < cues[i].end_ms, "cue start precedes its end");
    assert.ok(cues[i].start_ms >= 0 && cues[i].end_ms <= 4000, "cue stays within scene duration");
    if (i > 0) assert.equal(cues[i].start_ms, cues[i - 1].end_ms, "cues are contiguous");
  }
});
test("explicit caption_cues are validated and returned unchanged", () => {
  const explicit = [{ text: "Custom one", start_ms: 0, end_ms: 400 }, { text: "Custom two", start_ms: 400, end_ms: 1000 }];
  const scene = { ...snapshot.scenes[0], caption_cues: explicit };
  assert.deepEqual(cuesForScene(scene), explicit);
});
test("overlapping explicit cues are rejected", () => assert.throws(
  () => validateCues([{ text: "a", start_ms: 0, end_ms: 600 }, { text: "b", start_ms: 400, end_ms: 900 }], 1000),
  /overlapping/
));
test("out-of-range explicit cues are rejected", () => assert.throws(
  () => validateCues([{ text: "a", start_ms: -1, end_ms: 600 }], 1000),
  /invalid caption cue range/
));
test("cues beyond scene duration are rejected", () => assert.throws(
  () => validateCues([{ text: "a", start_ms: 0, end_ms: 1200 }], 1000),
  /invalid caption cue range/
));
test("inverted cue ranges (start >= end) are rejected", () => assert.throws(
  () => validateCues([{ text: "a", start_ms: 500, end_ms: 500 }], 1000),
  /invalid caption cue range/
));
test("update_scene rejects overlapping caption_cues", () => assert.throws(
  () => applyCommand(snapshot, {
    command_id: "c7", project_id: "p1", base_revision: 0, client_timestamp: "", kind: "update_scene",
    payload: { scene: { ...snapshot.scenes[0], caption_cues: [{ text: "a", start_ms: 0, end_ms: 600 }, { text: "b", start_ms: 400, end_ms: 900 }] } }
  }),
  /overlapping/
));
test("render plan resolves each scene's cue list (derived or explicit)", () => {
  const plan = renderPlan(snapshot);
  assert.ok(Array.isArray(plan.scenes[0].caption_cues));
  assert.ok(plan.scenes[0].caption_cues.length > 0);
});
test("coverCropFilter offsets the crop by the focal point", () => {
  const offCenter = coverCropFilter(720, 1280, 0.75, 0.25);
  assert.deepEqual(offCenter, [
    "scale=720:1280:force_original_aspect_ratio=increase",
    "crop=720:1280:(iw-ow)*0.75:(ih-oh)*0.25"
  ]);
  const centered = coverCropFilter(720, 1280, 0.5, 0.5);
  assert.deepEqual(centered, [
    "scale=720:1280:force_original_aspect_ratio=increase",
    "crop=720:1280:(iw-ow)*0.5:(ih-oh)*0.5"
  ]);
});
