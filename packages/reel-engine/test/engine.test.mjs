import test from "node:test";
import assert from "node:assert/strict";
import { conceptsFor, applyCommand, buildStoryboardDraft, planStoryboardScenes, renderPlan, cuesForScene, cueAtElapsed, spokenWordIndex, spokenWords, spokenWordsForCues, validateCues, coverCropFilter } from "../dist/index.js";

const snapshot = {
  schema_version: 1, id: "p1", owner_id: "u1", revision: 0,
  brief: { purpose: "Launch", audience: "Teams", tone: "Warm" },
  scenes: [{ id: "s1", order: 0, caption: "Hello", duration_ms: 1000, focal_x: .5, focal_y: .5, motion: "none", audio_level: 1, ducking: Boolean(0) }]
};
const referenceProfile = { width: 720, height: 1280, watermark: "Reference preview" };
const lifecycleScene = (id, order) => ({
  ...snapshot.scenes[0],
  id,
  order,
  caption: `Caption ${id}`,
  visual_prompt: `cinematic ocean detail ${id}`
});
const command = (kind, payload, base_revision = 0) => ({
  command_id: `${kind}-${base_revision}`,
  project_id: "p1",
  base_revision,
  client_timestamp: "diagnostic",
  kind,
  payload
});

test("concept construction is deterministic and exactly three", () => {
  const concepts = conceptsFor(snapshot.brief);
  assert.equal(concepts.length, 3);
  assert.deepEqual(concepts.map(({ id }) => id), ["direct", "story", "rhythm"]);
  assert.deepEqual(concepts, conceptsFor(snapshot.brief));
  for (const concept of concepts) {
    assert.ok(concept.hook.length > 8);
    assert.ok(concept.beat_summary.length > 8);
    assert.ok(concept.media_direction.length > 8);
    assert.ok([15, 30, 45].includes(concept.duration_seconds));
    assert.ok([4, 5, 6].includes(concept.scene_count));
  }
});
test("shared storyboard planning separates footage intent from copy and closes with the CTA", () => {
  let id = 0;
  const scenes = buildStoryboardDraft("Portrait campaign", () => `scene-${++id}`, {
    goal: "promote", audience: "social", structure: "story_arc", tone: "cinematic", pace: "balanced", durationSeconds: 15, media: "stock"
  }, {
    caption: "A quiet portrait story unfolds. Small details reveal the setting.",
    visualHint: "editorial portrait photography Prague",
    callToAction: "Open the full gallery."
  });
  assert.equal(scenes.length, 4);
  assert.match(scenes[0].visual_prompt, /editorial portrait photography/i);
  assert.equal(scenes[0].title, undefined);
  assert.equal(scenes[0].caption, "A quiet portrait story unfolds.");
  assert.equal(scenes[1].caption, "Small details reveal the setting.");
  assert.equal(scenes.at(-1).caption, "See Portrait campaign.");
  assert.doesNotMatch(scenes.map(({ caption }) => caption).join("\n"), /open the full gallery|the story begins/i);
  assert.ok(scenes.every((scene) => scene.motion === "zoom"));
});
test("imported galleries do not share queue-template overlay copy", () => {
  const architecture = {
    goal: "promote", audience: "social", structure: "story_arc", tone: "cinematic", pace: "balanced", durationSeconds: 15, media: "own"
  };
  let id = 0;
  const girl = buildStoryboardDraft("Anonym Girl — December 2021", () => `g-${++id}`, architecture, {
    caption: 'Still worth the two minutes: "Anonym Girl — December 2021".',
    callToAction: "Open the full gallery."
  });
  id = 0;
  const recap = buildStoryboardDraft("Anonym Girl — December 2021", () => `r-${++id}`, architecture, {
    caption: "Weekly recap: Anonym Girl — December 2021",
    callToAction: "Open the full gallery."
  });
  id = 0;
  const naples = buildStoryboardDraft("Weekend in Naples — July 2019", () => `n-${++id}`, architecture, {
    caption: "Weekly recap: Weekend in Naples — July 2019",
    callToAction: "Open the full gallery."
  });
  assert.equal(girl[0].caption, "Anonym Girl");
  assert.equal(girl[0].overlay_look, "title");
  assert.equal(girl[1].caption, "December 2021");
  assert.equal(girl.at(-1).caption, "See Anonym Girl.");
  assert.deepEqual(girl.map(({ caption, title }) => ({ caption, title })), recap.map(({ caption, title }) => ({ caption, title })));
  assert.equal(naples[0].caption, "Weekend in Naples");
  assert.equal(naples.at(-1).caption, "See Weekend in Naples.");
  assert.notDeepEqual(girl.map(({ caption, title }) => [title, caption]), naples.map(({ caption, title }) => [title, caption]));
  assert.doesNotMatch(
    [...girl, ...recap, ...naples].map(({ caption, title }) => `${title ?? ""} ${caption}`).join("\n"),
    /still worth the two minutes|weekly recap|open the full gallery|the story begins/i
  );
});
test("concept planner yields a stable 4–6 beat storyboard without provider vocabulary", () => {
  let id = 0;
  const first = planStoryboardScenes(
    { purpose: "Calm studio introduction for a product launch", audience: "Customers", tone: "Warm" },
    "direct",
    () => `scene-${++id}`
  );
  id = 0;
  const second = planStoryboardScenes(
    { purpose: "Calm studio introduction for a product launch", audience: "Customers", tone: "Warm" },
    "direct",
    () => `scene-${++id}`
  );
  assert.deepEqual(first, second);
  assert.ok(first.length >= 4 && first.length <= 6);
  assert.equal(new Set(first.map(({ id: sceneId }) => sceneId)).size, first.length);
  assert.deepEqual(first.map(({ order }) => order), first.map((_, order) => order));
  const total = first.reduce((sum, scene) => sum + scene.duration_ms, 0);
  assert.ok(total >= 15_000 && total <= 60_000);
  for (const scene of first) {
    assert.ok(scene.visual_prompt);
    assert.doesNotMatch(scene.visual_prompt, /\b(pexels|fal|beatoven|openai|llm)\b/i);
    assert.doesNotMatch(scene.caption, /\b(pexels|fal|beatoven|openai|llm)\b/i);
  }
});
test("direct, story, and rhythm concepts produce observably different multi-scene plans", () => {
  const brief = { purpose: "Calm studio introduction for a product launch", audience: "Customers", tone: "Warm" };
  const plans = ["direct", "story", "rhythm"].map((conceptId) => {
    let id = 0;
    return planStoryboardScenes(brief, conceptId, () => `${conceptId}-${++id}`);
  });
  assert.deepEqual(plans.map((scenes) => scenes.length), [4, 5, 6]);
  assert.deepEqual(plans.map((scenes) => scenes.reduce((sum, scene) => sum + scene.duration_ms, 0)), [15_000, 30_000, 45_000]);
  assert.notDeepEqual(plans[0].map(({ caption }) => caption), plans[1].map(({ caption }) => caption));
  assert.notDeepEqual(plans[1].map(({ visual_prompt }) => visual_prompt), plans[2].map(({ visual_prompt }) => visual_prompt));
  assert.match(plans[0][0].caption, /launch/i);
  assert.match(plans[1][0].caption, /launch/i);
  assert.match(plans[2][0].caption, /launch/i);
});
test("select_concept seeds a multi-scene plan when the project is empty", () => {
  const empty = { ...snapshot, scenes: [] };
  const result = applyCommand(empty, {
    command_id: "seed",
    project_id: "p1",
    base_revision: 0,
    client_timestamp: "diagnostic",
    kind: "select_concept",
    payload: { concept_id: "story" }
  });
  assert.equal(result.selected_concept_id, "story");
  assert.ok(result.scenes.length >= 4 && result.scenes.length <= 6);
  assert.ok(result.scenes.every((scene) => scene.visual_prompt));
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
test("replace_storyboard accepts one, four, and eight ordered scenes", () => {
  for (const count of [1, 4, 8]) {
    const scenes = Array.from({ length: count }, (_, order) => lifecycleScene(`s${order + 1}`, order));
    const result = applyCommand(snapshot, command("replace_storyboard", { scenes }));
    assert.equal(result.scenes.length, count);
    assert.equal(result.revision, 1);
  }
});
test("replace_storyboard enforces size, unique IDs, contiguous order, and visual prompts", () => {
  for (const scenes of [
    [],
    Array.from({ length: 9 }, (_, order) => lifecycleScene(`s${order}`, order)),
    [lifecycleScene("same", 0), lifecycleScene("same", 1)],
    [lifecycleScene("s1", 0), lifecycleScene("s2", 2)],
    [{ ...lifecycleScene("s1", 0), visual_prompt: undefined }]
  ]) {
    assert.throws(() => applyCommand(snapshot, command("replace_storyboard", { scenes })));
  }
});
test("scene visual prompts must be trimmed and no longer than 240 characters", () => {
  for (const visual_prompt of ["", " padded ", "x".repeat(241)]) {
    assert.throws(() => applyCommand(snapshot, command("replace_storyboard", {
      scenes: [{ ...lifecycleScene("s1", 0), visual_prompt }]
    })), /visual prompt/);
  }
});
test("add_scene inserts at the beginning, middle, and end and normalizes order", () => {
  let current = applyCommand(snapshot, command("replace_storyboard", {
    scenes: [lifecycleScene("s1", 0), lifecycleScene("s3", 1)]
  }));
  current = applyCommand(current, command("add_scene", { scene: lifecycleScene("s0", 9), at: 0 }, 1));
  current = applyCommand(current, command("add_scene", { scene: lifecycleScene("s2", 9), at: 2 }, 2));
  current = applyCommand(current, command("add_scene", { scene: lifecycleScene("s4", 9), at: 4 }, 3));
  assert.deepEqual(current.scenes.map(({ id, order }) => ({ id, order })), [
    { id: "s0", order: 0 },
    { id: "s1", order: 1 },
    { id: "s2", order: 2 },
    { id: "s3", order: 3 },
    { id: "s4", order: 4 }
  ]);
});
test("add_scene rejects a ninth scene and duplicate IDs", () => {
  const full = { ...snapshot, scenes: Array.from({ length: 8 }, (_, order) => lifecycleScene(`s${order}`, order)) };
  assert.throws(() => applyCommand(full, command("add_scene", { scene: lifecycleScene("s8", 8), at: 8 })), /8 scenes/);
  assert.throws(() => applyCommand(snapshot, command("add_scene", { scene: lifecycleScene("s1", 1), at: 1 })), /duplicate/);
});
test("remove_scene normalizes order and retains at least one scene", () => {
  const multiple = { ...snapshot, scenes: [lifecycleScene("s1", 0), lifecycleScene("s2", 1), lifecycleScene("s3", 2)] };
  const result = applyCommand(multiple, command("remove_scene", { scene_id: "s2" }));
  assert.deepEqual(result.scenes.map(({ id, order }) => ({ id, order })), [
    { id: "s1", order: 0 },
    { id: "s3", order: 1 }
  ]);
  assert.throws(() => applyCommand(snapshot, command("remove_scene", { scene_id: "s1" })), /retain one/);
  assert.throws(() => applyCommand(multiple, command("remove_scene", { scene_id: "missing" })), /unknown scene/);
});
test("storyboard lifecycle commands do not mutate snapshots or command payloads", () => {
  const original = { ...snapshot, scenes: [lifecycleScene("s1", 0), lifecycleScene("s2", 1)] };
  const payload = { scene: lifecycleScene("s3", 99), at: 1 };
  const beforeSnapshot = structuredClone(original);
  const beforePayload = structuredClone(payload);
  applyCommand(original, command("add_scene", payload));
  assert.deepEqual(original, beforeSnapshot);
  assert.deepEqual(payload, beforePayload);
});
test("render presentation is required host input without changing resolved scenes", () => {
  const reference = renderPlan(snapshot, referenceProfile);
  const alternate = renderPlan(snapshot, { width: 1080, height: 1920 });
  assert.deepEqual(
    { width: reference.width, height: reference.height, watermark: reference.watermark },
    referenceProfile
  );
  assert.deepEqual(
    { width: alternate.width, height: alternate.height, watermark: alternate.watermark },
    { width: 1080, height: 1920, watermark: undefined }
  );
  assert.deepEqual(reference.scenes, alternate.scenes);
});

test("render profile rejects unsafe dimensions and watermark values", () => {
  for (const profile of [
    { width: 15, height: 1280 },
    { width: 720.5, height: 1280 },
    { width: 720, height: 7681 }
  ]) {
    assert.throws(() => renderPlan(snapshot, profile), /dimensions/);
  }
  for (const watermark of ["", " padded ", "x".repeat(121)]) {
    assert.throws(
      () => renderPlan(snapshot, { width: 720, height: 1280, watermark }),
      /watermark/
    );
  }
});

test("spoken words keep the full phrase and highlight by clock", () => {
  const words = spokenWords("cosmic dust space travel", 2000);
  assert.equal(words.map(({ text }) => text).join(" "), "cosmic dust space travel");
  assert.equal(words[0].start_ms, 0);
  assert.equal(words[words.length - 1].end_ms, 2000);
  assert.equal(spokenWordIndex(words, 0), 0);
  assert.equal(spokenWordIndex(words, 1999), words.length - 1);
  const cues = cuesForScene({
    ...snapshot.scenes[0],
    caption: "cosmic dust space travel",
    duration_ms: 2000
  });
  const timed = spokenWordsForCues(cues);
  assert.equal(timed.length, 4);
  assert.equal(timed.map(({ text }) => text).join(" "), "cosmic dust space travel");
});
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
  assert.equal(cueAtElapsed(cues, 0)?.text, cues[0].text);
  assert.equal(cueAtElapsed(cues, cues[0].end_ms)?.text, cues[1].text);
  assert.equal(cueAtElapsed(cues, 4000)?.text, cues[cues.length - 1].text);
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
  const plan = renderPlan(snapshot, referenceProfile);
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
test("update_scene stores a title and overlay place", () => {
  const updated = applyCommand(snapshot, command("update_scene", {
    scene: { ...snapshot.scenes[0], title: "Naplavka", overlay_place: "center" }
  }));
  assert.equal(updated.scenes[0].title, "Naplavka");
  assert.equal(updated.scenes[0].overlay_place, "center");
  assert.throws(
    () => applyCommand(snapshot, command("update_scene", { scene: { ...snapshot.scenes[0], title: "" } })),
    /invalid title/
  );
});
test("update_soundtrack stores a stock bed on the brief and can clear it", () => {
  const withBed = applyCommand(snapshot, command("update_soundtrack", {
    soundtrack: { kind: "stock", stock_id: "pulse", bpm: 120, offset_ms: 0, level: 0.8 }
  }));
  assert.equal(withBed.brief.soundtrack?.stock_id, "pulse");
  assert.equal(withBed.revision, 1);
  const cleared = applyCommand(withBed, command("update_soundtrack", { soundtrack: null }, 1));
  assert.equal(cleared.brief.soundtrack, undefined);
  assert.throws(
    () => applyCommand(snapshot, command("update_soundtrack", { soundtrack: { kind: "stock", stock_id: "nope", bpm: 120, offset_ms: 0, level: 1 } })),
    /invalid soundtrack/
  );
});
test("update_voiceover stores uploaded narration on the brief and can clear it", () => {
  const withVo = applyCommand(snapshot, command("update_voiceover", {
    voiceover: { media_id: "vo-1", offset_ms: 0, level: 1 }
  }));
  assert.equal(withVo.brief.voiceover?.media_id, "vo-1");
  const cleared = applyCommand(withVo, command("update_voiceover", { voiceover: null }, 1));
  assert.equal(cleared.brief.voiceover, undefined);
  assert.throws(
    () => applyCommand(snapshot, command("update_voiceover", { voiceover: { media_id: "", offset_ms: 0, level: 1 } })),
    /invalid voiceover/
  );
});
