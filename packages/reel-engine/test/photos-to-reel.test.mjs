import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STORYBOARD_SCENES,
  PHOTOS_TO_REEL_MAX_MS,
  PHOTOS_TO_REEL_MOTIONS,
  PHOTOS_TO_REEL_PATTERN,
  PHOTOS_TO_REEL_TITLE,
  PhotoReelTooLongError,
  RENDER_FPS,
  applyCommand,
  beatMs,
  clampBpm,
  parseBeatPattern,
  photoFitTarget,
  photoReelText,
  photosToReelPlan,
  photosToReelScenes,
  photosToReelShotBeats
} from "../dist/index.js";

const EM_DASH = "\u2014";
const FRAME_MS = 1000 / RENDER_FPS;
const limits = { maxWidth: 4096, maxHeight: 4096, maxPixels: 16_000_000 };
const ids = (count) => Array.from({ length: count }, (_, index) => `shot-${index}`);

test("photo reel defaults are plain and fit the storyboard cap", () => {
  assert.deepEqual(PHOTOS_TO_REEL_PATTERN, [2, 3, 8]);
  assert.deepEqual(PHOTOS_TO_REEL_MOTIONS, ["zoom", "zoom_out", "push"]);
  assert.equal(PHOTOS_TO_REEL_MAX_MS, 90_000);
  for (const text of [PHOTOS_TO_REEL_TITLE, ...PHOTOS_TO_REEL_MOTIONS]) {
    assert.ok(!String(text).includes(EM_DASH), `${text} must not carry an em dash`);
  }
});

test("beat pattern reading keeps whole beats and falls back to the default", () => {
  assert.deepEqual(parseBeatPattern("2,3,8"), [2, 3, 8]);
  assert.deepEqual(parseBeatPattern(" 4 4 2 "), [4, 4, 2]);
  assert.deepEqual(parseBeatPattern("0,2"), [2]);
  assert.deepEqual(parseBeatPattern(""), [...PHOTOS_TO_REEL_PATTERN]);
  assert.deepEqual(parseBeatPattern(undefined), [...PHOTOS_TO_REEL_PATTERN]);
  assert.deepEqual(parseBeatPattern("x"), [...PHOTOS_TO_REEL_PATTERN]);
  assert.deepEqual(parseBeatPattern(new Array(9).fill(2)), [2, 2, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(parseBeatPattern("100"), [48]);
});

test("photo reel takes one shot per photo plus the end card, and no more", () => {
  assert.throws(() => photosToReelPlan({ photoCount: 0, bpm: 120 }), /at least one photo/);
  assert.throws(() => photosToReelPlan({ photoCount: MAX_STORYBOARD_SCENES, bpm: 120 }), /31 photos/);
  assert.equal(photosToReelPlan({ photoCount: MAX_STORYBOARD_SCENES - 1, bpm: 174 }).shots.length, MAX_STORYBOARD_SCENES);
  assert.deepEqual(photosToReelShotBeats(3), [2, 3, 8, 2]);
});

test("23 photos plus the end card build 24 beat snapped shots", () => {
  const plan = photosToReelPlan({ photoCount: 23, bpm: 174 });
  assert.equal(plan.shots.length, 24);
  assert.equal(plan.shots.filter((shot) => shot.role === "photo").length, 23);
  assert.equal(plan.shots.at(-1).role, "end_card");
  assert.equal(plan.total_frames, 1076);
  assert.equal(plan.total_ms, (1076 / RENDER_FPS) * 1000);
  assert.equal(Math.round(plan.total_ms), 35_867);
  assert.ok(plan.total_ms <= PHOTOS_TO_REEL_MAX_MS, "the usual 23 photo reel stays under the length limit");
  const beat = beatMs(174);
  for (const shot of plan.shots) {
    assert.ok(Math.abs(shot.duration_ms - shot.beats * beat) <= FRAME_MS, `shot ${shot.index} drifts off the beat`);
    assert.ok(shot.duration_ms >= 500 && shot.duration_ms <= 15_000, `shot ${shot.index} must fit the scene contract`);
  }
  const scenes = photosToReelScenes(plan, { ids: ids(24) });
  const applied = applyCommand({
    schema_version: 1,
    id: "p1",
    owner_id: "u1",
    revision: 0,
    brief: { purpose: "Launch", audience: "Teams", tone: "Warm" },
    scenes: [{ ...scenes[0], id: "old-0", caption: "Old shot" }]
  }, {
    command_id: "photo-reel-23",
    project_id: "p1",
    base_revision: 0,
    client_timestamp: "diagnostic",
    kind: "replace_storyboard",
    payload: { scenes }
  });
  assert.equal(applied.scenes.length, 24);
  assert.deepEqual(applied.scenes.map((scene) => scene.order), Array.from({ length: 24 }, (_, order) => order));
});

test("a photo reel over the length limit names its running time", () => {
  // 13 shots of 12 beats at 60 BPM is 156 seconds, well past the limit.
  const tooLong = () => photosToReelPlan({ photoCount: 12, bpm: 60, pattern: "12" });
  assert.throws(tooLong, PhotoReelTooLongError);
  assert.throws(tooLong, /over the 90 second limit/);
  try {
    tooLong();
  } catch (error) {
    assert.ok(error instanceof PhotoReelTooLongError);
    assert.equal(error.total_ms, 156_000);
    assert.equal(error.limit_ms, PHOTOS_TO_REEL_MAX_MS);
  }
});

test("photo reel at 174 BPM lands every cut on the beat grid", () => {
  const plan = photosToReelPlan({ photoCount: 4, bpm: 174 });
  assert.equal(plan.bpm, 174);
  assert.deepEqual(plan.pattern, [2, 3, 8]);
  assert.deepEqual(plan.shots.map((shot) => shot.beats), [2, 3, 8, 2, 3]);
  assert.deepEqual(plan.shots.map((shot) => shot.role), ["photo", "photo", "photo", "photo", "end_card"]);
  assert.deepEqual(plan.shots.map((shot) => shot.start_frame), [0, 21, 52, 134, 155]);
  assert.deepEqual(plan.shots.map((shot) => shot.end_frame), [21, 52, 134, 155, 186]);
  assert.equal(plan.total_frames, 186);
  assert.equal(plan.total_ms, 6200);
  const beat = beatMs(174);
  for (const shot of plan.shots) {
    assert.ok(Math.abs(shot.duration_ms - shot.beats * beat) <= FRAME_MS, `shot ${shot.index} drifts off the beat`);
    assert.ok(shot.duration_ms <= 15_000, `shot ${shot.index} must fit the scene contract`);
  }
});


test("photo reel alternates zoom in, zoom out and pan", () => {
  const plan = photosToReelPlan({ photoCount: 6, bpm: 120, pattern: "2" });
  assert.deepEqual(plan.shots.map((shot) => shot.motion), [
    "zoom", "zoom_out", "push", "zoom", "zoom_out", "push", "zoom"
  ]);
});

test("photo reel keeps a one beat pattern inside the shortest scene", () => {
  // 174 BPM is a 345 ms beat, so a 1 beat shot would fall under the 0.5 s floor.
  const plan = photosToReelPlan({ photoCount: 2, bpm: 174, pattern: "1" });
  assert.deepEqual(plan.shots.map((shot) => shot.beats), [2, 2, 2]);
});

test("photo reel scenes carry the title on shot one and the end card last", () => {
  const plan = photosToReelPlan({ photoCount: 3, bpm: 120, title: "Summer  trip", endCard: "Follow for part two" });
  const scenes = photosToReelScenes(plan, {
    ids: ids(plan.shots.length),
    captions: ["First look", "Second look", "Third look"]
  });
  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map((scene) => scene.order), [0, 1, 2, 3]);
  assert.deepEqual(scenes.map((scene) => scene.id), ids(4));
  assert.equal(scenes[0].overlay_look, "title");
  assert.equal(scenes[0].title, "Summer trip");
  assert.equal(scenes[0].overlay_place, "center");
  assert.equal(scenes[1].overlay_look, undefined);
  assert.equal(scenes[1].caption, "Second look");
  const endCard = scenes[3];
  assert.equal(endCard.caption, "Follow for part two");
  assert.equal(endCard.overlay_look, "spoken");
  assert.equal(endCard.overlay_place, "center");
  assert.deepEqual(scenes.map((scene) => scene.duration_ms), plan.shots.map((shot) => shot.duration_ms));
  assert.deepEqual(scenes.map((scene) => scene.motion), plan.shots.map((shot) => shot.motion));
});

test("photo reel scenes fall back to plain text instead of empty fields", () => {
  const plan = photosToReelPlan({ photoCount: 1, bpm: 120, title: "   ", endCard: "" });
  const scenes = photosToReelScenes(plan, { ids: ids(2) });
  assert.equal(scenes[0].title, PHOTOS_TO_REEL_TITLE);
  assert.equal(scenes[0].caption, "");
  assert.equal(scenes[0].visual_prompt, PHOTOS_TO_REEL_TITLE);
  assert.ok(scenes[1].caption.length > 0);
  assert.equal(photoReelText("  a\n b  ", 3), "a b");
  assert.throws(() => photosToReelScenes(plan, { ids: ids(3) }), /one scene id per shot/);
  assert.throws(() => photosToReelScenes(plan, { ids: ids(1) }), /one scene id per shot/);
});

test("large stills fit the media limits and small ones are left alone", () => {
  // 36 MP camera stills are over both the side and pixel ceilings.
  assert.deepEqual(photoFitTarget(7360, 4912, limits), { width: 4096, height: 2733 });
  assert.deepEqual(photoFitTarget(8000, 2000, limits), { width: 4096, height: 1024 });
  assert.deepEqual(photoFitTarget(2000, 8000, limits), { width: 1024, height: 4096 });
  assert.equal(photoFitTarget(1080, 1920, limits), undefined);
  // 4096 square clears the side ceiling but not the 16 MP pixel ceiling.
  assert.deepEqual(photoFitTarget(4096, 4096, limits), { width: 4000, height: 4000 });
  assert.equal(photoFitTarget(4000, 4000, limits), undefined);
  assert.equal(photoFitTarget(0, 0, limits), undefined);
  assert.equal(photoFitTarget(Number.NaN, 20, limits), undefined);
  const fitted = photoFitTarget(7360, 4912, limits);
  assert.ok(fitted.width <= limits.maxWidth && fitted.height <= limits.maxHeight);
  assert.ok(fitted.width * fitted.height <= limits.maxPixels);
  assert.equal(clampBpm(174), 174);
  assert.equal(clampBpm(undefined), 120);
});

test("photo reel scenes pass the replace_storyboard command, zoom_out included", () => {
  const plan = photosToReelPlan({ photoCount: 2, bpm: 120, pattern: "2,3" });
  const scenes = photosToReelScenes(plan, { ids: ids(plan.shots.length) });
  assert.ok(scenes.some((scene) => scene.motion === "zoom_out"));
  const applied = applyCommand({
    schema_version: 1,
    id: "p1",
    owner_id: "u1",
    revision: 0,
    brief: { purpose: "Launch", audience: "Teams", tone: "Warm" },
    scenes: [{ ...scenes[0], id: "old-0", caption: "Old shot" }]
  }, {
    command_id: "photo-reel-0",
    project_id: "p1",
    base_revision: 0,
    client_timestamp: "diagnostic",
    kind: "replace_storyboard",
    payload: { scenes }
  });
  assert.deepEqual(applied.scenes.map((scene) => scene.motion), plan.shots.map((shot) => shot.motion));
  assert.deepEqual(applied.scenes.map((scene) => scene.duration_ms), plan.shots.map((shot) => shot.duration_ms));
});

