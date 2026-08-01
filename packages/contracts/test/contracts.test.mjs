import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { acceptsFixture, isProjectSnapshot, isStoryboardScenes } from "../dist/index.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));

const snapshotWithPrompt = (visual_prompt) => ({
  schema_version: 1,
  id: "project-1",
  owner_id: "user-1",
  revision: 0,
  brief: { purpose: "Launch", audience: "Customers", tone: "Warm" },
  scenes: [{
    id: "scene-1",
    order: 0,
    caption: "Launch",
    duration_ms: 1000,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "none",
    audio_level: 1,
    ducking: false,
    ...(visual_prompt === undefined ? {} : { visual_prompt })
  }]
});

test("additive v1 fields are tolerated", async () => assert.equal(acceptsFixture(await fixture("project-v1.json")), true));
test("breaking fixture version is rejected", async () => assert.equal(acceptsFixture(await fixture("project-v2-breaking.json")), false));
test("render snapshots reject malformed scenes", () => {
  assert.equal(isProjectSnapshot({
    schema_version: 1,
    id: "project-1",
    owner_id: "user-1",
    revision: 0,
    brief: { purpose: "Launch", audience: "Customers", tone: "Warm" },
    scenes: [{
      id: "scene-1",
      order: 0,
      caption: "Launch",
      duration_ms: 0,
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "none",
      audio_level: 1,
      ducking: false
    }]
  }), false);
});

test("visual_prompt is additive and accepts a trimmed search description", () => {
  assert.equal(isProjectSnapshot(snapshotWithPrompt(undefined)), true);
  assert.equal(isProjectSnapshot(snapshotWithPrompt("remote island seen from above at dusk")), true);
});

test("visual_prompt rejects blank, padded, and oversized values", () => {
  for (const prompt of ["", " padded ", "x".repeat(241)]) {
    assert.equal(isProjectSnapshot(snapshotWithPrompt(prompt)), false);
  }
});

test("storyboard lifecycle validation enforces scene count, IDs, order, and prompts", () => {
  const scene = snapshotWithPrompt("remote island").scenes[0];
  assert.equal(isStoryboardScenes([scene], true), true);
  assert.equal(isStoryboardScenes([], true), false);
  assert.equal(isStoryboardScenes(Array.from({ length: 9 }, (_, order) => ({ ...scene, id: `scene-${order}`, order })), true), false);
  assert.equal(isStoryboardScenes([scene, { ...scene, order: 1 }], true), false);
  assert.equal(isStoryboardScenes([scene, { ...scene, id: "scene-2", order: 2 }], true), false);
  assert.equal(isStoryboardScenes([{ ...scene, visual_prompt: undefined }], true), false);
});
