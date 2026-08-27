import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiResponseError, briefNeedsMediaLook, briefReadyMessage, briefShouldGlance, buildStoryboardDraft, mediaNotesFromGlances, nextBriefQuestion, parseBriefChat, recommendVideoArchitecture, sceneDurationForMedia, sampleCanvasStats, toneFromSample } from "../src/api.ts";

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
  assert.deepEqual(recommendVideoArchitecture("mystery murder in san francisco"), {
    goal: "story", audience: "general", structure: "mystery", tone: "cinematic",
    pace: "slow", durationSeconds: 30, media: "stock"
  });
});

test("create chat asks only missing brief questions, at most four", () => {
  const audience = nextBriefQuestion("mystery murder in san francisco", false, []);
  assert.equal(audience?.id, "audience");
  assert.match(audience?.prompt ?? "", /San Francisco mystery/);
  assert.doesNotMatch(audience?.prompt ?? "", /^Who is this for\?$/);
  const afterSocial = nextBriefQuestion("mystery murder in san francisco\nSocial media audience", false, ["audience"]);
  assert.equal(afterSocial?.id, "length");
  assert.match(afterSocial?.prompt ?? "", /reel/);
  assert.equal(afterSocial?.choices[0], "About 15 seconds");
  const afterGeneral = nextBriefQuestion("mystery murder in san francisco\nGeneral viewers", false, ["audience"]);
  assert.match(afterGeneral?.prompt ?? "", /San Francisco mystery/);
  assert.equal(afterGeneral?.choices[0], "About 30 seconds");
  const visuals = nextBriefQuestion("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds", false, ["audience", "length"]);
  assert.equal(visuals?.id, "visuals");
  assert.match(visuals?.prompt ?? "", /San Francisco/);
  assert.doesNotMatch(visuals?.prompt ?? "", /^Where should the pictures come from\?$/);
  assert.equal(nextBriefQuestion("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds\nPexels real stock video", false, ["audience", "length", "visuals"]), undefined);
  assert.equal(nextBriefQuestion("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds", true, ["audience", "length"]), undefined);
  assert.equal(nextBriefQuestion("Launch a 15 second reel using stock to promote our product for customers", false, []), undefined);
  assert.match(briefReadyMessage("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds\nPexels real stock video"), /mystery about mystery murder in san francisco/);
  const stored = parseBriefChat(JSON.stringify({
    messages: [{ role: "assistant", text: "What do you want to make?" }],
    asked: ["audience"],
    composer: "mystery murder in san francisco"
  }));
  assert.equal(stored.composer, "mystery murder in san francisco");
  assert.deepEqual(stored.asked, ["audience"]);
});

test("own-media glance notes adapt the next question without a VLM", () => {
  const dark = sampleCanvasStats(Uint8ClampedArray.from([8, 10, 40, 255, 12, 14, 48, 255]));
  assert.ok(dark.luminance < 0.35);
  assert.equal(toneFromSample(0.2, -0.1).mood, "dark");
  const notes = mediaNotesFromGlances([{
    name: "sf-alley.jpg",
    kind: "image",
    bytes: 1200,
    width: 1080,
    height: 1920,
    orientation: "portrait",
    luminance: 0.2,
    warmth: -0.1
  }]);
  assert.match(notes, /I looked at 1 photo/);
  assert.match(notes, /portrait/);
  assert.match(notes, /dark/);
  assert.match(notes, /sf alley/);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nMy own media", 0), true);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nMy own media", 2), false);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nMix Pexels stock and my media", 0), true);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nMix Pexels stock and my media", 2), false);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nPexels real stock video", 0), false);
  assert.equal(briefNeedsMediaLook("I'll use my photos", 0), true);
  assert.equal(briefShouldGlance("mystery\nMy own media", 0), false);
  assert.equal(briefShouldGlance("mystery\nMy own media", 2), true);
  assert.equal(briefShouldGlance(`mystery\n${notes}`, 2), false);
  assert.equal(briefShouldGlance("mystery\nPexels real stock video", 2), false);
  assert.equal(briefShouldGlance("mystery\nMix Pexels stock and my media", 1), true);
  assert.equal(briefShouldGlance("mystery\nGeneral viewers", 2), false);
  assert.equal(briefShouldGlance("I added 2 photos.", 2), true);
  const intent = nextBriefQuestion(notes, true, []);
  assert.equal(intent?.id, "intent");
  assert.match(intent?.prompt ?? "", /dark, portrait/);
  assert.match(intent?.prompt ?? "", /story/);
  const mixNext = nextBriefQuestion(`mystery murder in san francisco\nMix Pexels stock and my media\n${notes}`, true, []);
  assert.equal(mixNext?.id, "audience");
  assert.match(mixNext?.prompt ?? "", /San Francisco mystery/);
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

test("a short cinematic phrase stays one speakable caption, not one word per scene", () => {
  const scenes = buildStoryboardDraft("cosmic dust space travel", ids());
  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map(({ caption }) => caption), ["cosmic dust space travel", "", "", ""]);
  const planned = buildStoryboardDraft("cosmic dust space travel", ids(), {
    goal: "story", audience: "general", structure: "story_arc", tone: "cinematic",
    pace: "balanced", durationSeconds: 15, media: "stock"
  });
  assert.equal(planned[0].caption, "Cosmic dust space travel.");
  assert.deepEqual(planned.slice(1).map(({ caption }) => caption), ["", "", ""]);
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

test("mystery murder in san francisco stays one speakable caption on a cinematic mystery plan", () => {
  const brief = "mystery murder in san francisco";
  const scenes = buildStoryboardDraft(brief, ids(), recommendVideoArchitecture(brief));
  assert.equal(scenes.length, 5);
  assert.deepEqual(scenes.map(({ caption }) => caption), [
    "Mystery murder in san francisco.",
    "",
    "",
    "",
    ""
  ]);
  assert.match(scenes[0].visual_prompt, /mysterious murder san francisco/);
  assert.match(scenes[0].visual_prompt, /fog wide aerial establishing cinematic$/);
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
