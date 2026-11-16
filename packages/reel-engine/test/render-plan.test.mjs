import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RENDER_FPS,
  RENDER_PLAN_BRAND_MARK_REF,
  RENDER_PLAN_ENCODE_DEFAULTS,
  RENDER_PLAN_FONTS,
  RENDER_PLAN_FPS,
  RENDER_PLAN_SCHEMA,
  RENDER_PLAN_VERSION,
  RenderPlanError,
  buildRenderPlanV1,
  isRenderPlanV1,
  renderPlanMusicId,
  renderPlanMusicRef,
  validateRenderPlanV1
} from "../dist/index.js";

const scene = (overrides) => ({
  id: "s1",
  order: 0,
  caption: "Hello there",
  duration_ms: 1000,
  focal_x: 0.5,
  focal_y: 0.5,
  motion: "none",
  audio_level: 1,
  ducking: false,
  ...overrides
});

const snapshot = (overrides) => ({
  schema_version: 1,
  id: "p1",
  owner_id: "u1",
  revision: 4,
  brief: { purpose: "Launch", audience: "Teams", tone: "Warm" },
  scenes: [scene()],
  ...overrides
});

const profile = { width: 720, height: 1280, watermark: "Reference preview" };

test("plan carries the frame rate the worker already burns", () => {
  assert.equal(RENDER_PLAN_FPS, RENDER_FPS);
  assert.equal(RENDER_PLAN_SCHEMA, "fmotion.render-plan");
  assert.equal(RENDER_PLAN_VERSION, 1);
  assert.equal(RENDER_PLAN_BRAND_MARK_REF, "brand_mark");
  assert.deepEqual(RENDER_PLAN_FONTS, {
    title: "Inter Display ExtraBold",
    caption: "Inter SemiBold"
  });
});

test("plan keeps the cached encoder settings byte for byte", () => {
  const plan = buildRenderPlanV1(snapshot(), profile);
  assert.deepEqual(plan.encode, RENDER_PLAN_ENCODE_DEFAULTS);
  assert.deepEqual(plan.encode, {
    video: "h264",
    video_bitrate: "8M",
    pixel_format: "yuv420p",
    audio: "aac",
    audio_rate: 44100,
    audio_channels: 2
  });
});

test("motion presets reach the plan as numbers, with the pull out reversed", () => {
  const plan = buildRenderPlanV1(snapshot({
    scenes: [
      scene({ id: "s1", order: 0, media_id: "still-wide", motion: "zoom_out" }),
      scene({ id: "s2", order: 1, caption: "", media_id: "clip-tall", motion: "push" }),
      scene({ id: "s3", order: 2, caption: "", media_id: "still-tall", motion: "none" })
    ]
  }), profile, {
    "still-wide": { kind: "still", width: 1600, height: 1200 },
    "clip-tall": { kind: "video", width: 1080, height: 1920, has_audio: true },
    "still-tall": { kind: "still", width: 1080, height: 1920 }
  });
  assert.deepEqual(plan.scenes.map((item) => item.motion), [
    { type: "zoom", zoom_start: 1.06, zoom_end: 1, pan_scale: 1.06, axis: "x", easing: "cosine", sample_scale: 2 },
    { type: "push", zoom_start: 1, zoom_end: 1.06, pan_scale: 1.06, axis: "y", easing: "cosine", sample_scale: 2 },
    { type: "none", zoom_start: 1, zoom_end: 1.06, pan_scale: 1.06, axis: "y", easing: "cosine", sample_scale: 1 }
  ]);
});

test("media descriptors become opaque refs with the facts the renderer needs", () => {
  const plan = buildRenderPlanV1(snapshot({
    scenes: [
      scene({ id: "s1", order: 0, media_id: "still-wide" }),
      scene({ id: "s2", order: 1, media_id: "clip-tall" })
    ]
  }), profile, {
    "still-wide": { kind: "still", width: 1600, height: 1200 },
    "clip-tall": { kind: "video", width: 1080, height: 1920, has_audio: false }
  });
  assert.deepEqual(plan.scenes[0].media, {
    ref: "still-wide", kind: "still", width: 1600, height: 1200, has_audio: false
  });
  assert.deepEqual(plan.scenes[1].media, {
    ref: "clip-tall", kind: "video", width: 1080, height: 1920, has_audio: false
  });
});

test("a video descriptor without a has_audio answer keeps its sound", () => {
  const plan = buildRenderPlanV1(snapshot({ scenes: [scene({ media_id: "clip" })] }), profile, {
    clip: { kind: "video", width: 1080, height: 1920 }
  });
  assert.equal(plan.scenes[0].media.has_audio, true);
});

test("caption words reach the plan in order and inside the scene clock", () => {
  const plan = buildRenderPlanV1(snapshot({
    scenes: [scene({ caption: "One small step forward", duration_ms: 2000 })]
  }), profile);
  const overlay = plan.scenes[0].overlay;
  assert.ok(overlay);
  assert.equal(overlay.look, "caption");
  assert.equal(overlay.place, "bottom");
  assert.equal(overlay.title, null);
  assert.equal(overlay.font_title, RENDER_PLAN_FONTS.title);
  assert.equal(overlay.font_caption, RENDER_PLAN_FONTS.caption);
  assert.equal(overlay.words.map((word) => word.text).join(" "), "One small step forward");
  assert.equal(overlay.words[0].start_ms, 0);
  assert.equal(overlay.words.at(-1).end_ms, 2000);
  for (let index = 1; index < overlay.words.length; index += 1) {
    assert.equal(overlay.words[index].start_ms, overlay.words[index - 1].end_ms);
  }
});

test("a silent still scene burns no overlay at all", () => {
  const plan = buildRenderPlanV1(snapshot({ scenes: [scene({ caption: "" })] }), profile);
  assert.equal(plan.scenes[0].overlay, null);
});

test("a title look without a title borrows the caption and drops its words", () => {
  const plan = buildRenderPlanV1(snapshot({
    scenes: [scene({ caption: "Borrowed line", look: "caption", overlay_look: "title" })]
  }), profile);
  const overlay = plan.scenes[0].overlay;
  assert.equal(overlay.look, "title");
  assert.equal(overlay.place, "center");
  assert.equal(overlay.title, "Borrowed line");
  assert.deepEqual(overlay.words, []);
});

test("a scene title rides on the overlay and keeps its words", () => {
  const plan = buildRenderPlanV1(snapshot({
    scenes: [scene({ title: "Launch day", caption: "Doors open", overlay_place: "top" })]
  }), profile);
  const overlay = plan.scenes[0].overlay;
  assert.equal(overlay.title, "Launch day");
  assert.equal(overlay.place, "top");
  assert.equal(overlay.words.length, 2);
});

test("a spoken look never keeps a scene title", () => {
  const plan = buildRenderPlanV1(snapshot({
    scenes: [scene({ title: "Launch day", caption: "Doors open", overlay_look: "spoken" })]
  }), profile);
  const overlay = plan.scenes[0].overlay;
  assert.equal(overlay.look, "spoken");
  assert.equal(overlay.title, null);
  assert.equal(overlay.words.length, 2);
});

test("a catalogue bed travels as a music ref and the duck is the voiceover gain", () => {
  const plan = buildRenderPlanV1(snapshot({
    brief: {
      purpose: "Launch",
      audience: "Teams",
      tone: "Warm",
      soundtrack: { kind: "stock", bpm: 101, offset_ms: 250, level: 0.4, stock_id: "pulse" },
      voiceover: { media_id: "voice-1", offset_ms: 0, level: 0.9 }
    }
  }), profile, { "voice-1": { kind: "video", width: 0, height: 0, has_audio: true } });
  assert.deepEqual(plan.audio.bed, { ref: "music:pulse", level: 0.4, offset_ms: 250, loop: true });
  assert.deepEqual(plan.audio.voice, { ref: "voice-1", level: 0.9, offset_ms: 0 });
  assert.equal(plan.audio.duck, 0.22);
  assert.equal(renderPlanMusicId(plan.audio.bed.ref), "pulse");
  assert.equal(renderPlanMusicId("voice-1"), undefined);
  assert.equal(renderPlanMusicRef("pulse"), "music:pulse");
});

test("an uploaded bed is a plain media id and still loops", () => {
  const plan = buildRenderPlanV1(snapshot({
    brief: {
      purpose: "Launch",
      audience: "Teams",
      tone: "Warm",
      soundtrack: { kind: "upload", bpm: 120, offset_ms: 0, level: 1, media_id: "bed-1" }
    }
  }), { width: 720, height: 1280 }, { "bed-1": { kind: "video", width: 0, height: 0 } });
  assert.equal(plan.audio.bed.ref, "bed-1");
  assert.equal(plan.audio.bed.loop, true);
  assert.equal(plan.watermark, null);
  assert.equal(plan.brand_mark, null);
});

test("the brand mark becomes a ref plus the pixel box the filter draws", () => {
  const plan = buildRenderPlanV1(snapshot({
    brief: { purpose: "Launch", audience: "Teams", tone: "Warm", brand_mark: true, brand_mark_size: "compact" }
  }), profile);
  assert.deepEqual(plan.brand_mark, {
    ref: RENDER_PLAN_BRAND_MARK_REF, width: 144, x: 29, y: 45, opacity: 0.45
  });
  const standard = buildRenderPlanV1(snapshot({
    brief: { purpose: "Launch", audience: "Teams", tone: "Warm", brand_mark: true, brand_mark_size: "standard" }
  }), profile);
  assert.deepEqual(standard.brand_mark, {
    ref: RENDER_PLAN_BRAND_MARK_REF, width: 302, x: 43, y: 64, opacity: 0.45
  });
});

test("media the renderer does not hold fails the plan instead of drawing gray", () => {
  assert.throws(
    () => buildRenderPlanV1(snapshot({ scenes: [scene({ media_id: "missing" })] }), profile),
    /scene media input missing/
  );
  assert.throws(
    () => buildRenderPlanV1(snapshot({
      brief: {
        purpose: "Launch",
        audience: "Teams",
        tone: "Warm",
        soundtrack: { kind: "upload", bpm: 120, offset_ms: 0, level: 1, media_id: "bed-1" }
      }
    }), profile),
    /soundtrack media input missing/
  );
  assert.throws(
    () => buildRenderPlanV1(snapshot({
      brief: {
        purpose: "Launch",
        audience: "Teams",
        tone: "Warm",
        soundtrack: { kind: "stock", bpm: 120, offset_ms: 0, level: 1 }
      }
    }), profile),
    /stock music bed missing/
  );
  assert.throws(
    () => buildRenderPlanV1(snapshot({
      brief: {
        purpose: "Launch",
        audience: "Teams",
        tone: "Warm",
        voiceover: { media_id: "voice-1", offset_ms: 0, level: 1 }
      }
    }), profile),
    /voiceover media input missing/
  );
});

test("a snapshot with no scenes renders one placeholder scene", () => {
  const plan = buildRenderPlanV1(snapshot({ scenes: [] }), profile);
  assert.equal(plan.scenes.length, 1);
  assert.deepEqual(plan.scenes[0].media, { ref: "", kind: "none", width: 0, height: 0, has_audio: false });
  assert.equal(plan.scenes[0].motion.type, "none");
  assert.equal(plan.scenes[0].motion.sample_scale, 1);
  assert.equal(plan.scenes[0].overlay, null);
  assert.equal(plan.scenes[0].duration_ms, 200);
});

test("a plan survives a JSON round trip through the validator unchanged", () => {
  const plan = buildRenderPlanV1(snapshot({
    brief: {
      purpose: "Launch",
      audience: "Teams",
      tone: "Warm",
      brand_mark: true,
      soundtrack: { kind: "stock", bpm: 101, offset_ms: 0, level: 0.5, stock_id: "pulse" },
      voiceover: { media_id: "voice-1", offset_ms: 120, level: 1 }
    },
    scenes: [
      scene({ id: "s1", order: 0, media_id: "still-1", title: "Launch day" }),
      scene({ id: "s2", order: 1, caption: "Second beat", media_id: "clip-1", motion: "push" })
    ]
  }), profile, {
    "still-1": { kind: "still", width: 1600, height: 1200 },
    "clip-1": { kind: "video", width: 1080, height: 1920 },
    "voice-1": { kind: "video", width: 0, height: 0 }
  });
  const wire = JSON.stringify(plan);
  const read = validateRenderPlanV1(JSON.parse(wire));
  assert.deepEqual(read, plan);
  assert.equal(isRenderPlanV1(JSON.parse(wire)), true);
  assert.equal(JSON.stringify(read), wire);
});

test("a plan from a newer schema is refused, not guessed", () => {
  const plan = buildRenderPlanV1(snapshot(), profile);
  assert.throws(
    () => validateRenderPlanV1({ ...plan, version: 2 }),
    (error) => error instanceof RenderPlanError && /unsupported version 2/.test(error.message)
  );
  assert.throws(() => validateRenderPlanV1({ ...plan, schema: "fmotion.reel" }), /schema must be/);
  assert.equal(isRenderPlanV1({ ...plan, version: 2 }), false);
});

test("unknown fields are ignored while a wrong one is named", () => {
  const plan = buildRenderPlanV1(snapshot(), profile);
  const forward = { ...plan, revision: 9, created_at: "later" };
  assert.deepEqual(validateRenderPlanV1(forward), plan);
  assert.throws(
    () => validateRenderPlanV1({
      ...plan,
      scenes: [{ ...plan.scenes[0], crop: { focal_x: 1.5, focal_y: 0.5 } }]
    }),
    /scenes\[0\]\.crop\.focal_x must stay between 0 and 1/
  );
  assert.throws(
    () => validateRenderPlanV1({
      ...plan,
      audio: { bed: { ref: "music:pulse", level: 0.5, offset_ms: 0, loop: false }, voice: null, duck: 1 }
    }),
    /audio\.bed\.loop must be true/
  );
  assert.throws(
    () => validateRenderPlanV1({ ...plan, scenes: [] }),
    /scenes must be a non-empty array/
  );
});

const sharedFixtures = [
  "render-plan-v1-photo-reel.json",
  "render-plan-v1-brand-mark.json",
  "render-plan-v1-voice-and-bed.json",
  "render-plan-v1-contain.json"
];

const sharedFixture = async (name) =>
  JSON.parse(await readFile(new URL(`../../contracts/fixtures/${name}`, import.meta.url), "utf8"));

const renderPlanSchema = async () =>
  JSON.parse(await readFile(new URL("../../contracts/schema/render-plan-v1.schema.json", import.meta.url), "utf8"));

test("the committed fixtures are plans the phone can read", async () => {
  for (const name of sharedFixtures) {
    const plan = validateRenderPlanV1(await sharedFixture(name));
    assert.equal(plan.schema, RENDER_PLAN_SCHEMA);
    assert.equal(plan.version, RENDER_PLAN_VERSION);
    assert.ok(plan.scenes.length > 0, `${name} has no scenes`);
    assert.deepEqual(validateRenderPlanV1(JSON.parse(JSON.stringify(plan))), plan);
  }
  const refs = sharedFixtures.map(async (name) => (await sharedFixture(name)).scenes.map((s) => s.media.ref));
  for (const sceneRefs of await Promise.all(refs)) {
    for (const ref of sceneRefs) assert.doesNotMatch(ref, /^(https?:|\/|s3:|file:)/, "ref must stay opaque");
  }
});

test("the JSON schema lists exactly the fields a plan carries", async () => {
  const schema = await renderPlanSchema();
  assert.equal(schema.$id, "urn:f-engine:contracts:render-plan:v1");
  const keys = (object) => Object.keys(object).sort();
  const required = (name) => [...schema.$defs[name].required].sort();

  for (const name of sharedFixtures) {
    const plan = validateRenderPlanV1(await sharedFixture(name));
    assert.deepEqual([...schema.required].sort(), keys(plan), name);
    assert.deepEqual(required("encode"), keys(plan.encode), name);
    assert.deepEqual(required("audio"), keys(plan.audio), name);
    if (plan.audio.bed) assert.deepEqual(required("bed"), keys(plan.audio.bed), name);
    if (plan.audio.voice) assert.deepEqual(required("track"), keys(plan.audio.voice), name);
    if (plan.brand_mark) assert.deepEqual(required("brand_mark"), keys(plan.brand_mark), name);
    for (const scene of plan.scenes) {
      assert.deepEqual(required("scene"), keys(scene), name);
      assert.deepEqual(required("media"), keys(scene.media), name);
      assert.deepEqual(required("crop"), keys(scene.crop), name);
      assert.deepEqual(required("motion"), keys(scene.motion), name);
      if (!scene.overlay) continue;
      assert.deepEqual(required("overlay"), keys(scene.overlay), name);
      for (const word of scene.overlay.words) assert.deepEqual(required("word"), keys(word), name);
    }
  }
});





