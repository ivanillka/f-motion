import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { acceptsFixture, isProjectSnapshot } from "../dist/index.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));

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
