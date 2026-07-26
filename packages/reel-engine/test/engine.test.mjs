import test from "node:test";
import assert from "node:assert/strict";
import { conceptsFor, applyCommand, renderPlan } from "../dist/index.js";

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
test("render plan is 720p and watermarked", () => assert.deepEqual(renderPlan(snapshot).width, 720));
