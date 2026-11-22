import test from "node:test";
import assert from "node:assert/strict";
import { checkCodes, checkProject } from "../dist/index.js";

function scene(overrides = {}) {
  return {
    id: "s1",
    order: 0,
    caption: "A quiet morning by the river.",
    duration_ms: 3000,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "gentle",
    audio_level: 1,
    ducking: false,
    media_id: "m1",
    ...overrides
  };
}

function snapshot(scenes, brief = {}) {
  return {
    id: "p1",
    revision: 1,
    brief: { purpose: "launch", audience: "locals", tone: "warm", ...brief },
    scenes
  };
}

const ready = { m1: { state: "ready" } };

function codes(report) {
  return report.errors.map((entry) => entry.code);
}

test("check codes are unique and stable", () => {
  assert.equal(new Set(checkCodes).size, checkCodes.length);
  assert.deepEqual([...checkCodes].sort(), [
    "brand_mark_overlap",
    "caption_empty",
    "invalid_cues",
    "media_missing",
    "media_not_ready",
    "overlay_overflow",
    "spoken_cue_overrun",
    "spoken_take_overrun",
    "storyboard_empty"
  ]);
});

test("a clean storyboard has no issues", () => {
  const report = checkProject(snapshot([scene()]), { media: ready });
  assert.deepEqual(report, { errors: [], warnings: [] });
});

test("an empty storyboard is an error", () => {
  const report = checkProject(snapshot([]));
  assert.deepEqual(codes(report), ["storyboard_empty"]);
  assert.equal(report.errors[0].scene_id, undefined);
});

test("media must exist and be ready", () => {
  const report = checkProject(
    snapshot([
      scene({ id: "s1", order: 0, media_id: undefined }),
      scene({ id: "s2", order: 1, media_id: "m2" }),
      scene({ id: "s3", order: 2, media_id: "m3" })
    ]),
    { media: { m2: { state: "missing" }, m3: { state: "admitted" } } }
  );
  assert.deepEqual(codes(report), ["media_missing", "media_missing", "media_not_ready"]);
  assert.deepEqual(report.errors.map((entry) => entry.scene_id), ["s1", "s2", "s3"]);
});

test("a spoken or title scene needs words", () => {
  const report = checkProject(
    snapshot([
      scene({ id: "s1", order: 0, overlay_look: "spoken", caption: "   " }),
      scene({ id: "s2", order: 1, overlay_look: "title", caption: "", title: " " })
    ]),
    { media: ready }
  );
  assert.deepEqual(codes(report), ["caption_empty", "caption_empty"]);
  assert.deepEqual(report.errors.map((entry) => entry.scene_id), ["s1", "s2"]);
});

test("cue timing outside the scene length is an error", () => {
  const report = checkProject(
    snapshot([
      scene({ caption_cues: [{ text: "Too long", start_ms: 0, end_ms: 4000 }] })
    ]),
    { media: ready }
  );
  assert.deepEqual(codes(report), ["invalid_cues"]);
});

test("a word that cannot fit the safe area at the smallest size is an error", () => {
  const chunked = checkProject(
    snapshot([scene({ overlay_look: "spoken", caption: "a".repeat(20) })]),
    { media: ready }
  );
  assert.deepEqual(codes(chunked), ["overlay_overflow"]);

  // Thirteen characters shrink instead of breaking, so the export stays valid.
  const shrunk = checkProject(
    snapshot([scene({ overlay_look: "spoken", caption: "extraordinary" })]),
    { media: ready }
  );
  assert.deepEqual(shrunk, { errors: [], warnings: [] });
});

test("the standard mark over the top caption is a warning, compact clears it", () => {
  const top = scene({ overlay_place: "top" });
  const compact = checkProject(snapshot([top], { brand_mark: true }), { media: ready });
  assert.deepEqual(compact, { errors: [], warnings: [] });

  const standard = checkProject(
    snapshot([top], { brand_mark: true, brand_mark_size: "standard" }),
    { media: ready }
  );
  assert.deepEqual(standard.errors, []);
  assert.deepEqual(standard.warnings.map((entry) => entry.code), ["brand_mark_overlap"]);
  assert.equal(standard.warnings[0].scene_id, "s1");
});

test("a spoken take longer than its scene is an error", () => {
  const report = checkProject(
    snapshot([scene({ overlay_look: "spoken", caption: "Hello there", duration_ms: 2000 })]),
    { media: ready, spoken_takes: { s1: 3000 } }
  );
  assert.deepEqual(codes(report), ["spoken_take_overrun"]);
});

test("a cue that outlives the spoken take is an error", () => {
  const report = checkProject(
    snapshot([
      scene({
        overlay_look: "spoken",
        caption: "Hello there",
        duration_ms: 4000,
        caption_cues: [{ text: "Hello there", start_ms: 0, end_ms: 2500 }]
      })
    ]),
    { media: ready, spoken_takes: { s1: 2000 } }
  );
  assert.deepEqual(codes(report), ["spoken_cue_overrun"]);
});

test("a take plus the breath fits its scene without an issue", () => {
  const report = checkProject(
    snapshot([scene({ overlay_look: "spoken", caption: "Hello there", duration_ms: 2020 })]),
    { media: ready, spoken_takes: { s1: 1900 } }
  );
  assert.deepEqual(report, { errors: [], warnings: [] });
});

test("issues follow scene order, not array order", () => {
  const report = checkProject(
    snapshot([
      scene({ id: "late", order: 1, media_id: undefined }),
      scene({ id: "early", order: 0, media_id: undefined })
    ])
  );
  assert.deepEqual(report.errors.map((entry) => entry.scene_id), ["early", "late"]);
});
