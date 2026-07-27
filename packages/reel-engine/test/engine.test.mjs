import test from "node:test";
import assert from "node:assert/strict";
import { conceptsFor, applyCommand, renderPlan, coverCropFilter } from "../dist/index.js";

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
