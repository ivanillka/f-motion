import test from "node:test";
import assert from "node:assert/strict";
import {
  generateReelSession,
  isReelCraftPayload,
  mediaPrefFromPlan,
  projectBriefFromReelCraft,
  scenesFromReelCraft
} from "../src/create-flow-client.ts";

test("mediaPrefFromPlan never claims Pexels without a key", () => {
  assert.equal(mediaPrefFromPlan({ media: "stock" }, { hasOwn: false, pexelsConnected: false }), "defer");
  assert.equal(mediaPrefFromPlan({ media: "stock" }, { hasOwn: false, pexelsConnected: true }), "pexels");
  assert.equal(mediaPrefFromPlan({ media: "mixed" }, { hasOwn: true, pexelsConnected: true }), "mix");
  assert.equal(mediaPrefFromPlan({ media: "mixed" }, { hasOwn: true, pexelsConnected: false }), "own");
  assert.equal(mediaPrefFromPlan({ media: "own" }, { hasOwn: false, pexelsConnected: true }), "defer");
});

test("scenesFromReelCraft drops catalog media ids and reindexes", () => {
  const craft = {
    kind: "reel_storyboard",
    architecture: {
      goal: "story",
      audience: "social",
      structure: "story_arc",
      tone: "cinematic",
      pace: "balanced",
      durationSeconds: 15,
      media: "own",
      delivery: "reel"
    },
    conceptId: "direct",
    editorModel: "storyboard",
    preview: { surface: "reel_player", aspect: "9:16" },
    mediaAttach: [{ sceneId: "s1", mediaId: "pool-1" }],
    scenes: [{
      id: "s1",
      order: 0,
      caption: "Hello",
      duration_ms: 3000,
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "zoom",
      audio_level: 1,
      ducking: false,
      media_id: "pool-1",
      visual_prompt: "harbor night"
    }]
  };
  assert.ok(isReelCraftPayload(craft));
  const scenes = scenesFromReelCraft(craft);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].media_id, undefined);
  assert.notEqual(scenes[0].id, "s1");
  assert.equal(scenes[0].visual_prompt, "harbor night");
  const brief = projectBriefFromReelCraft(craft, {
    purpose: "Harbor night",
    audience: "social",
    tone: "cinematic, balanced"
  });
  assert.equal(brief.architecture?.delivery, "reel");
});

test("generateReelSession walks create-session spine and returns reel craft", async () => {
  const calls = [];
  const craft = {
    kind: "reel_storyboard",
    architecture: {
      goal: "promote",
      audience: "customers",
      structure: "problem_solution",
      tone: "energetic",
      pace: "fast",
      durationSeconds: 15,
      media: "stock",
      delivery: "reel"
    },
    conceptId: "direct",
    editorModel: "storyboard",
    preview: { surface: "reel_player", aspect: "9:16" },
    mediaAttach: [],
    scenes: [{
      id: "s1",
      order: 0,
      caption: "Launch",
      duration_ms: 3000,
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "none",
      audio_level: 1,
      ducking: false,
      visual_prompt: "product hero"
    }]
  };
  const api = {
    async request(path, init = {}) {
      calls.push({ path, method: init.method ?? "GET", body: init.body });
      if (path === "/api/create-sessions") {
        return { session: { id: "sess-1", ownerId: "u", status: "drafting", poolMode: "skipped", brief: {}, mediaSourcePref: "defer", selectedTypeIds: [], artifacts: [] } };
      }
      if (path.endsWith("/settings") || path.endsWith("/generate")) {
        return {
          session: {
            id: "sess-1",
            ownerId: "u",
            status: "done",
            poolMode: "skipped",
            brief: { purpose: "Launch" },
            mediaSourcePref: "pexels",
            selectedTypeIds: ["reel_vertical"],
            artifacts: [{ id: "a1", typeId: "reel_vertical", status: "ready", craftPayload: craft }]
          }
        };
      }
      throw new Error(`unexpected ${path}`);
    }
  };
  const result = await generateReelSession(api, {
    purpose: "Launch",
    skipPool: true,
    mediaSourcePref: "pexels",
    durationSeconds: 15,
    animateStills: true
  });
  assert.equal(result.craft.kind, "reel_storyboard");
  assert.ok(calls.some((call) => call.path === "/api/create-sessions" && call.method === "POST"));
  assert.ok(calls.some((call) => call.path.endsWith("/generate")));
  assert.ok(!calls.some((call) => call.path.includes("carousel")));
  const settingsCall = calls.find((call) => call.path.endsWith("/settings"));
  assert.match(String(settingsCall?.body ?? ""), /animateStills/);
});
