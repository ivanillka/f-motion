import test from "node:test";
import assert from "node:assert/strict";
import {
  STORYBOARD_TEMPLATES_KEY,
  deleteStoryboardTemplate,
  readStoryboardTemplates,
  scenesFromTemplate,
  snapshotToTemplate,
  templateBriefFromProject,
  templateScenesFromProject,
  upsertStoryboardTemplate
} from "../src/storyboard-templates.ts";

function memoryStorage(seed = "") {
  let value = seed;
  return {
    get length() { return value ? 1 : 0; },
    clear() { value = ""; },
    getItem(key) { return key === STORYBOARD_TEMPLATES_KEY ? (value || null) : null; },
    key() { return null; },
    removeItem(key) { if (key === STORYBOARD_TEMPLATES_KEY) value = ""; },
    setItem(key, next) { if (key === STORYBOARD_TEMPLATES_KEY) value = next; }
  };
}

const sampleProject = {
  id: "proj-1",
  revision: 3,
  selected_concept_id: "story",
  brief: {
    purpose: "Elis Corner: Red Wall",
    audience: "social",
    tone: "cinematic",
    voiceover: { media_id: "vo-1", offset_ms: 0, level: 1 },
    soundtrack: {
      kind: "upload",
      bpm: 100,
      offset_ms: 0,
      level: 0.8,
      media_id: "audio-1"
    },
    architecture: {
      goal: "promote",
      audience: "social",
      structure: "story_arc",
      tone: "cinematic",
      pace: "balanced",
      durationSeconds: 30,
      media: "own"
    },
    cta: "What would you add?",
    brand_mark: true,
    frame: "both",
    mix: true
  },
  scenes: [
    {
      id: "s0",
      order: 0,
      caption: "Apartment light.",
      duration_ms: 6000,
      focal_x: 0.5,
      focal_y: 0.4,
      motion: "zoom",
      audio_level: 1,
      ducking: false,
      media_id: "media-cover",
      visual_prompt: "Selected gallery image 1",
      overlay_look: "title",
      overlay_place: "center",
      picture: "document"
    },
    {
      id: "s1",
      order: 1,
      caption: "See Elis Corner.",
      duration_ms: 6000,
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "push",
      audio_level: 0.9,
      ducking: true,
      media_id: "media-2",
      visual_prompt: "Selected gallery image 2"
    }
  ]
};

test("template snapshot strips media footage and keeps text scheme", () => {
  const template = snapshotToTemplate(sampleProject, " Red Wall beat ");
  assert.equal(template.name, "Red Wall beat");
  assert.equal(template.brief.purpose, "Elis Corner: Red Wall");
  assert.equal(template.brief.voiceover, undefined);
  assert.equal(template.brief.soundtrack, undefined);
  assert.equal(template.brief.architecture?.durationSeconds, 30);
  assert.equal(template.brief.cta, "What would you add?");
  assert.equal(template.brief.brand_mark, true);
  assert.equal(template.brief.frame, "both");
  assert.equal(template.brief.mix, true);
  assert.equal(template.scenes[0].picture, "document");
  assert.equal(template.scenes.length, 2);
  assert.equal(template.scenes[0].caption, "Apartment light.");
  assert.equal(template.scenes[0].overlay_look, "title");
  assert.ok(!("media_id" in template.scenes[0]));
  assert.ok(!("id" in template.scenes[0]));
});

test("stock soundtrack without upload media is kept on template brief", () => {
  const brief = templateBriefFromProject({
    purpose: "Pulse reel",
    audience: "social",
    tone: "energetic",
    soundtrack: { kind: "stock", bpm: 120, offset_ms: 0, level: 0.7, stock_id: "pulse", media_id: "ignore-me" }
  });
  assert.deepEqual(brief.soundtrack, {
    kind: "stock",
    bpm: 120,
    offset_ms: 0,
    level: 0.7,
    stock_id: "pulse"
  });
});

test("apply template rebuilds scenes without media_id", () => {
  const template = snapshotToTemplate(sampleProject, "Reuse");
  let n = 0;
  const scenes = scenesFromTemplate(template, () => `new-${++n}`);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].id, "new-1");
  assert.equal(scenes[0].media_id, undefined);
  assert.equal(scenes[0].caption, "Apartment light.");
  assert.equal(scenes[0].overlay_place, "center");
  assert.equal(scenes[1].motion, "push");
});

test("upsert and delete templates in storage", () => {
  const storage = memoryStorage();
  assert.deepEqual(readStoryboardTemplates(storage), []);
  const first = snapshotToTemplate(sampleProject, "A");
  upsertStoryboardTemplate(first, storage);
  const renamed = { ...first, name: "A edited", updatedAt: "2099-01-01T00:00:00.000Z" };
  upsertStoryboardTemplate(renamed, storage);
  const listed = readStoryboardTemplates(storage);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "A edited");
  deleteStoryboardTemplate(first.id, storage);
  assert.deepEqual(readStoryboardTemplates(storage), []);
});

test("templateScenesFromProject ignores caption_cues bags", () => {
  const scenes = templateScenesFromProject([
    {
      ...sampleProject.scenes[0],
      caption_cues: [{ t: 0, text: "x" }]
    }
  ]);
  assert.ok(!("caption_cues" in scenes[0]));
});
