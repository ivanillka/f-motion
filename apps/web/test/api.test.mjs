import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiResponseError, applyConversationConceptOverlays, beatsForConcept, buildStoryboardDraft, clientId, falSpeechLogTrail, falSpeechProgress, mergeConversationStoryboard, plannedVoiceScript, recommendVideoArchitecture, sceneDurationForMedia, stockBedForPace, storyboardArchitectureForConcept } from "../src/api.ts";

test("inspected video duration becomes a bounded scene duration", () => {
  assert.equal(sceneDurationForMedia(12_345.4, 3000), 12_345);
  assert.equal(sceneDurationForMedia(40_000, 3000), 15_000);
  assert.equal(sceneDurationForMedia(200, 3000), 500);
  assert.equal(sceneDurationForMedia(undefined, 3000), 3000);
});

test("conversation recommendations prefill distinct, editable video architectures", () => {
  assert.deepEqual(recommendVideoArchitecture("Mystery of a lonely island in ocean fog"), {
    goal: "story", audience: "general", structure: "mystery", tone: "cinematic",
    pace: "slow", durationSeconds: 30, media: "stock"
  });
  assert.deepEqual(recommendVideoArchitecture("Launch our product to customers as a fast 15 second reel using my videos and stock"), {
    goal: "promote", audience: "social", structure: "problem_solution", tone: "energetic",
    pace: "fast", durationSeconds: 15, media: "mixed"
  });
  assert.deepEqual(recommendVideoArchitecture("Documentary tutorial for employees using our footage"), {
    goal: "educate", audience: "internal", structure: "story_arc", tone: "documentary",
    pace: "balanced", durationSeconds: 45, media: "own"
  });
});

test("planned voice script prefers FAL caption over the visual description", () => {
  assert.equal(plannedVoiceScript({ caption: "  The bass dropped.  " }, "visual fog"), "The bass dropped.");
  assert.equal(plannedVoiceScript({ caption: "   " }, "  A lighthouse  "), "A lighthouse");
  assert.equal(plannedVoiceScript(undefined, "  brief  "), "brief");
  assert.equal(plannedVoiceScript({ caption: "x".repeat(1900) }, "brief").length, 1800);
});

test("FAL speech progress bar and log follow job state", () => {
  assert.equal(falSpeechProgress("quoted").percent, 8);
  assert.equal(falSpeechProgress("running", 0).percent, 45);
  assert.equal(falSpeechProgress("running", 30_000).percent, 55);
  assert.equal(falSpeechProgress("running", 600_000).percent, 84);
  assert.equal(falSpeechProgress("ready").percent, 100);
  assert.deepEqual(falSpeechLogTrail("running"), [
    "FAL priced this script.",
    "Queued for generation.",
    "Sending the script to FAL.",
    "FAL is synthesizing speech."
  ]);
  assert.equal(falSpeechLogTrail("failed").at(-1), "Generation failed.");
});

const ids = () => {
  let value = 0;
  return () => `scene-${++value}`;
};

test("four substantial mystery clauses become four deterministic beats", () => {
  const brief = "A lonely island waits in black water, a lighthouse flashes without a keeper; footprints cross the wet sand, then vanish at the sealed door.";
  const scenes = buildStoryboardDraft(brief, ids());
  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map(({ id, order }) => ({ id, order })), [
    { id: "scene-1", order: 0 }, { id: "scene-2", order: 1 },
    { id: "scene-3", order: 2 }, { id: "scene-4", order: 3 }
  ]);
  assert.deepEqual(scenes.map(({ visual_prompt }) => visual_prompt), [
    "A lonely island waits in black water",
    "a lighthouse flashes without a keeper",
    "footprints cross the wet sand",
    "then vanish at the sealed door"
  ]);
  assert.equal(scenes.map(({ caption }) => caption).join(" "), brief);
});

test("one sentence uses visible four-role prompts without repeating captions", () => {
  const brief = "A mysterious island rises from the ocean at dawn";
  const scenes = buildStoryboardDraft(brief, ids());
  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map(({ caption }) => caption), ["A mysterious island", "rises from", "the ocean", "at dawn"]);
  assert.match(scenes[0].visual_prompt, /wide establishing view$/);
  assert.match(scenes[3].visual_prompt, /closing wide shot$/);
});

test("Unicode, excess clauses, and very short text stay bounded", () => {
  const unicode = buildStoryboardDraft("Mlžný ostrov čeká tiše, světlo protíná noc; лодка дрейфует без людей", ids());
  assert.equal(unicode.length, 3);
  assert.match(unicode[2].visual_prompt, /лодка/u);
  const excess = buildStoryboardDraft("First substantial beat, second substantial beat, third substantial beat, fourth substantial beat, fifth substantial beat, sixth substantial beat, seventh substantial beat", ids());
  assert.equal(excess.length, 6);
  const short = buildStoryboardDraft("Hi", ids());
  assert.equal(short.length, 4);
  assert.deepEqual(short.map(({ caption }) => caption), ["Hi", "", "", ""]);
  assert.ok(short.every(({ visual_prompt }) => visual_prompt.length <= 240));
});

test("video architecture creates concrete, bounded Pexels searches and complete scene beats", () => {
  const scenes = buildStoryboardDraft("A lighthouse keeps flashing on an empty island", ids(), {
    goal: "story",
    audience: "social",
    structure: "mystery",
    tone: "documentary",
    pace: "slow",
    durationSeconds: 30,
    media: "mixed"
  });
  assert.equal(scenes.length, 5);
  assert.equal(scenes.reduce((sum, scene) => sum + scene.duration_ms, 0), 30_000);
  assert.match(scenes[0].visual_prompt, /lighthouse keeps flashing empty island fog wide aerial establishing documentary$/);
  assert.match(scenes[3].visual_prompt, /dramatic silhouette reveal documentary$/);
  assert.match(scenes[4].visual_prompt, /street dusk fog documentary$/);
  assert.ok(scenes.every(({ visual_prompt }) => visual_prompt.length <= 100));
  assert.deepEqual(scenes.map(({ caption }) => caption), [
    "A lighthouse keeps flashing on an empty island.",
    "",
    "",
    "",
    ""
  ]);
  assert.deepEqual(scenes.map(({ duration_ms }) => duration_ms), Array(5).fill(6000));
});

test("short vague input is not split into one-word scenes or sent to Pexels as editorial prose", () => {
  const scenes = buildStoryboardDraft("mystery culs in europe", ids(), {
    goal: "story",
    audience: "social",
    structure: "mystery",
    tone: "cinematic",
    pace: "balanced",
    durationSeconds: 30,
    media: "stock"
  });
  assert.deepEqual(scenes.map(({ caption }) => caption), [
    "Mystery culs in europe.",
    "",
    "",
    "",
    ""
  ]);
  assert.match(scenes[0].visual_prompt, /^mysterious hooded people european old town fog wide aerial establishing cinematic$/);
  assert.match(scenes[1].visual_prompt, /ancient symbol stone close up cinematic$/);
  assert.match(scenes[3].visual_prompt, /dramatic silhouette reveal cinematic$/);
  assert.ok(scenes.every(({ visual_prompt }) =>
    visual_prompt.length <= 100 && !/opening|pacing|unease/u.test(visual_prompt)));
});

test("FAL conversation overlays stay on Direct, Story, and Rhythm", () => {
  const concepts = applyConversationConceptOverlays([
    { id: "direct", title: "Direct", treatment: "engine", hook: "engine hook", beat_summary: "a", duration_seconds: 15, scene_count: 4, media_direction: "x" },
    { id: "story", title: "Story", treatment: "engine", hook: "engine hook", beat_summary: "a", duration_seconds: 30, scene_count: 5, media_direction: "x" },
    { id: "rhythm", title: "Rhythm", treatment: "engine", hook: "engine hook", beat_summary: "a", duration_seconds: 45, scene_count: 6, media_direction: "x" }
  ], {
    direct: { hook: "Lead with the light.", treatment: "Show the result first." },
    extra: { hook: "Invented fourth concept" }
  });
  assert.equal(concepts.length, 3);
  assert.equal(concepts[0].hook, "Lead with the light.");
  assert.equal(concepts[0].treatment, "Show the result first.");
  assert.equal(concepts[1].hook, "engine hook");
  assert.equal(concepts[2].id, "rhythm");
  assert.equal(storyboardArchitectureForConcept("direct", recommendVideoArchitecture("mystery island")).durationSeconds, 15);
  assert.equal(storyboardArchitectureForConcept("rhythm", recommendVideoArchitecture("mystery island")).structure, "chronological");
  const merged = mergeConversationStoryboard(
    [{ id: "keep-1", order: 0, caption: "old", duration_ms: 1000, focal_x: 0.5, focal_y: 0.5, motion: "none", audio_level: 1, ducking: false, media_id: "media-1" }],
    [{ id: "new-1", order: 0, caption: "new", duration_ms: 2000, focal_x: 0.5, focal_y: 0.5, motion: "zoom", audio_level: 1, ducking: false, visual_prompt: "fog" }]
  );
  assert.equal(merged[0].id, "keep-1");
  assert.equal(merged[0].media_id, "media-1");
  assert.equal(merged[0].caption, "new");
  assert.deepEqual(beatsForConcept("Problem → impact → friction → solution → proof → result", 4), [
    "Problem", "Impact", "Friction", "Solution"
  ]);
  assert.deepEqual(beatsForConcept("Start → progress", 4), ["Start", "Progress", "Beat 3", "Beat 4"]);
});

test("API requests read the current token and report unauthorized sessions", async () => {
  const originalFetch = globalThis.fetch;
  let token = "first";
  let unauthorized = 0;
  const seen = [];
  globalThis.fetch = async (_path, init) => {
    seen.push(new Headers(init.headers).get("authorization"));
    return new Response(JSON.stringify({ message: "expired" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = new ApiClient(() => token, () => { unauthorized += 1; });
    token = "refreshed";
    await assert.rejects(client.request("/api/projects"), (error) =>
      error instanceof ApiResponseError && error.status === 401);
    assert.deepEqual(seen, ["Bearer refreshed"]);
    assert.equal(unauthorized, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project listing rejects an HTML fallback response instead of crashing the page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!doctype html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });
  try {
    const client = new ApiClient(() => "token");
    await assert.rejects(client.listProjects(), /invalid projects response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function withoutRandomUUID(run) {
  const cryptoObj = globalThis.crypto;
  const original = Object.getOwnPropertyDescriptor(cryptoObj, "randomUUID");
  Object.defineProperty(cryptoObj, "randomUUID", { configurable: true, value: undefined });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(cryptoObj, "randomUUID", original);
    else delete cryptoObj.randomUUID;
  }
}

test("client IDs still generate when randomUUID is missing", () => {
  const id = withoutRandomUUID(() => clientId());
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(clientId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const second = withoutRandomUUID(() => clientId());
  assert.notEqual(second, id);
});

test("commands still send an id when randomUUID is missing", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (_path, init) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "p1", revision: 1, scenes: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = new ApiClient(() => "token");
    await withoutRandomUUID(() => client.command("p1", 0, "select_concept", { concept_id: "story" }));
    assert.match(body.command_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(body.kind, "select_concept");
    assert.equal(body.payload.concept_id, "story");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stock beds follow pace", () => {
  assert.equal(stockBedForPace("fast").id, "drive");
  assert.equal(stockBedForPace("slow").id, "air");
  assert.equal(stockBedForPace("balanced").id, "pulse");
});
