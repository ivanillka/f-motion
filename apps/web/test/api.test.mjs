import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiResponseError, BRIEF_OPENING, answeredBriefQuestions, briefDetailLines, briefNeedsMediaLook, briefPurposeFromChat, briefQuestionFor, briefReadyMessage, briefShouldGlance, briefWantsWordsOnScreen, briefWhereFromChat, buildStoryboardDraft, conceptIdForArchitecture, createEntryState, isBriefAnswerLine, mediaNotesFromGlances, newCommandId, newerSnapshot, nextBriefQuestion, parseBriefChat, photoCaptionConfirmText, photoCaptionEstimateUsd, photoNotesFromCaptions, recommendVideoArchitecture, sceneDurationForMedia, sampleCanvasStats, toneFromSample, withPhotoCaptions } from "../src/api.ts";

test("inspected video duration becomes a bounded scene duration", () => {
  assert.equal(sceneDurationForMedia(12_345.4, 3000), 12_345);
  assert.equal(sceneDurationForMedia(40_000, 3000), 15_000);
  assert.equal(sceneDurationForMedia(200, 3000), 500);
  assert.equal(sceneDurationForMedia(undefined, 3000), 3000);
});

test("brief purpose stays the first user line, not later chip answers", () => {
  assert.equal(
    briefPurposeFromChat("mystery murder in san francisco\nmystery murder i\nGeneral viewers\nAbout 30 seconds\nPexels videos"),
    "mystery murder in san francisco"
  );
  assert.equal(briefPurposeFromChat("", 2), "Video from 2 photos");
  assert.equal(conceptIdForArchitecture({ durationSeconds: 15 }), "direct");
  assert.equal(conceptIdForArchitecture({ durationSeconds: 30 }), "story");
  assert.equal(conceptIdForArchitecture({ durationSeconds: 45 }), "rhythm");
});

test("conversation recommendations prefill distinct, editable video architectures", () => {
  assert.deepEqual(recommendVideoArchitecture("Mystery of a lonely island in ocean fog"), {
    goal: "story", audience: "general", structure: "mystery", tone: "cinematic",
    pace: "slow", durationSeconds: 30, media: "stock", delivery: "reel"
  });
  assert.deepEqual(recommendVideoArchitecture("Launch our product to customers as a fast 15 second reel using my videos and stock"), {
    goal: "promote", audience: "social", structure: "problem_solution", tone: "energetic",
    pace: "fast", durationSeconds: 15, media: "mixed", delivery: "reel"
  });
  assert.deepEqual(recommendVideoArchitecture("Documentary tutorial for employees using our footage"), {
    goal: "educate", audience: "internal", structure: "story_arc", tone: "documentary",
    pace: "balanced", durationSeconds: 45, media: "own", delivery: "reel"
  });
  assert.deepEqual(recommendVideoArchitecture("mystery murder in san francisco"), {
    goal: "story", audience: "general", structure: "mystery", tone: "cinematic",
    pace: "slow", durationSeconds: 30, media: "stock", delivery: "reel"
  });
  assert.equal(recommendVideoArchitecture("YouTube widescreen product demo").delivery, "youtube");
});

test("a stale saved draft never becomes the subject of the chat", () => {
  const stale = "top dog breads\naliens in modern history";
  const feel = nextBriefQuestion(stale, false, []);
  assert.equal(feel?.id, "feel");
  assert.match(feel?.prompt ?? "", /aliens in modern history/i);
  assert.doesNotMatch(feel?.prompt ?? "", /top dog breads/i);
  // The newest line is the video, so the old draft never becomes the brief.
  assert.equal(briefPurposeFromChat(stale), "aliens in modern history");
  assert.equal(
    briefPurposeFromChat("top dog breads\naliens in modern history\nTell a story"),
    "aliens in modern history"
  );
  // The same topic written in full keeps the fuller wording.
  assert.equal(
    briefPurposeFromChat("mystery murder i\nmystery murder in san francisco"),
    "mystery murder in san francisco"
  );
});

test("brief questions strip i need a story about prefixes from the subject", () => {
  const audience = nextBriefQuestion("i need a story about aliens on earth", false, []);
  assert.match(audience?.prompt ?? "", /aliens on earth/i);
  assert.doesNotMatch(audience?.prompt ?? "", /i need a story about/i);
});

test("newCommandId works when randomUUID is blocked on insecure http", () => {
  const original = crypto.randomUUID;
  crypto.randomUUID = () => {
    throw new DOMException("insecure", "SecurityError");
  };
  assert.match(newCommandId(), /^[a-z0-9]+-[a-z0-9]+$/);
  crypto.randomUUID = original;
});

test("create asks at most three missing questions, named after the owner's own words", () => {
  // One line with a place already answers subject and moment, so the chat goes
  // straight to the question it cannot guess, and names the video it means.
  const feel = nextBriefQuestion("mystery murder in san francisco", false, []);
  assert.equal(feel?.id, "feel");
  assert.match(feel?.prompt ?? "", /San Francisco mystery/);
  assert.doesNotMatch(feel?.prompt ?? "", /^How should this video feel\?$/);
  assert.deepEqual(feel?.choices, ["Warm and calm", "Fast and loud", "Funny and light", "Serious and quiet"]);
  // A feel answer is read from the words, not asked twice.
  const words = nextBriefQuestion("mystery murder in san francisco", false, ["feel"]);
  assert.equal(words?.id, "words");
  assert.match(words?.prompt ?? "", /carry words on screen/);
  assert.deepEqual(words?.choices, ["Words on screen", "No words at all", "Only a title and a closing line"]);
  assert.equal(nextBriefQuestion("mystery murder in san francisco\nWarm and calm", false, ["feel"])?.id, "words");
  // Three questions is the ceiling: the storyboard is offered instead of a fourth.
  assert.equal(nextBriefQuestion("mystery murder in san francisco", false, ["feel", "words", "ending"]), undefined);
  assert.equal(
    nextBriefQuestion("mystery murder in san francisco", false, ["feel", "words", "ending", "length"]),
    undefined
  );
  // A brief that already answers every slot is not asked anything at all.
  assert.equal(
    nextBriefQuestion(
      "mystery murder in san francisco tonight, warm and calm, words on screen, end on a question, about 30 seconds, Pexels videos",
      false,
      []
    ),
    undefined
  );
  // A long request is not read back as the subject of its own questions.
  assert.match(
    nextBriefQuestion("Launch a 15 second reel using stock to promote our product for customers", false, [])?.prompt ?? "",
    /our product/
  );
  // Nothing yet says where the pictures come from, unless the words say so.
  assert.equal(
    answeredBriefQuestions(
      "A fictional lighthouse no camera has recorded\nTell a story\nGeneral viewers\nAbout 15 seconds",
      false
    ).has("visuals"),
    false
  );
  assert.equal(
    answeredBriefQuestions(
      "A fictional lighthouse that does not exist on stock\nTell a story\nGeneral viewers\nAbout 15 seconds",
      false
    ).has("visuals"),
    true
  );
  assert.match(briefReadyMessage("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds\nPexels videos"), /That is enough to make your storyboard/);
  assert.match(briefReadyMessage("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds\nPexels videos"), /about 30 seconds/);
  assert.doesNotMatch(briefReadyMessage("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds\nPexels videos"), /More settings|Continue when you are ready/);
  assert.doesNotMatch(briefReadyMessage("mystery murder in san francisco\nGeneral viewers\nAbout 30 seconds\nPexels videos"), /General viewers/);
  const stored = parseBriefChat(JSON.stringify({
    messages: [{ role: "assistant", text: "What do you want to make?" }],
    asked: ["feel"],
    composer: "mystery murder in san francisco"
  }));
  assert.equal(stored.composer, "mystery murder in san francisco");
  assert.deepEqual(stored.asked, ["feel"]);
});

test("create opens a fresh intake and only resumes what was started", () => {
  const chat = [
    { role: "assistant", text: "What do you want to make?" },
    { role: "user", text: "mystery murder in san francisco" }
  ];
  const stored = { messages: chat, asked: ["audience"], composer: "About 30 seconds" };
  // A new video never carries the last chat, even when that chat is unfinished.
  assert.deepEqual(createEntryState(stored, { fresh: true, draft: "mystery murder in san francisco" }), {
    messages: [BRIEF_OPENING],
    asked: [],
    composer: "",
    conversation: "",
    keepStored: false
  });
  // The sidebar Create entry resumes the chat and the brief behind it.
  const resumed = createEntryState(stored, { draft: "mystery murder in san francisco\nGeneral viewers" });
  assert.equal(resumed.messages, chat);
  assert.deepEqual(resumed.asked, ["audience"]);
  assert.equal(resumed.composer, "About 30 seconds");
  assert.equal(resumed.conversation, "mystery murder in san francisco\nGeneral viewers");
  assert.equal(resumed.keepStored, true);
  // A line typed but never sent is offered again instead of being lost.
  const typed = createEntryState({ messages: [BRIEF_OPENING], asked: [], composer: "  launch teaser  " });
  assert.deepEqual(typed, {
    messages: [BRIEF_OPENING],
    asked: [],
    composer: "launch teaser",
    conversation: "launch teaser",
    keepStored: true
  });
  assert.deepEqual(
    createEntryState({ messages: [BRIEF_OPENING], asked: [], composer: "launch teaser" }, { fresh: true }),
    { messages: [BRIEF_OPENING], asked: [], composer: "", conversation: "", keepStored: false }
  );
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
  assert.match(notes, /mostly portrait/);
  assert.match(notes, /fairly dark/);
  assert.match(notes, /sf alley/);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nUse my photos", 0), true);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nUse my photos", 2), false);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nUse both photos and Pexels", 0), true);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nUse both photos and Pexels", 2), false);
  assert.equal(briefNeedsMediaLook("mystery murder in san francisco\nPexels videos", 0), false);
  assert.equal(briefNeedsMediaLook("I'll use my photos", 0), true);
  assert.equal(briefShouldGlance("mystery\nUse my photos", 0), false);
  assert.equal(briefShouldGlance("mystery\nUse my photos", 2), true);
  assert.equal(briefShouldGlance(`mystery\n${notes}`, 2), false);
  assert.equal(briefShouldGlance("mystery\nPexels videos", 2), false);
  assert.equal(briefShouldGlance("mystery\nUse both photos and Pexels", 1), true);
  assert.equal(briefShouldGlance("mystery\nGeneral viewers", 2), false);
  assert.equal(briefShouldGlance("I added 2 photos.", 2), true);
  const subject = nextBriefQuestion(notes, true, []);
  assert.equal(subject?.id, "subject");
  assert.match(subject?.prompt ?? "", /What is happening in these photos/);
  assert.deepEqual(subject?.choices, ["Just what the photos show", "A story around them"]);
  const mixNext = nextBriefQuestion(`mystery murder in san francisco\nUse both photos and Pexels\n${notes}`, true, []);
  assert.equal(mixNext?.id, "feel");
  assert.match(mixNext?.prompt ?? "", /San Francisco mystery/);
});

const connectedSourceAnswers = {
  choices: ["Pexels videos", "AI images with FAL (paid, asks first)", "Use my photos"],
  connected: ["Pexels", "FAL"],
  hint: ""
};

const ownOnlySourceAnswers = {
  choices: ["Use my photos"],
  connected: [],
  hint: "Connect Pexels, Civitai and FAL in Settings to use them here."
};

test("the picture question offers the sources this studio really has", () => {
  const question = nextBriefQuestion(
    "mystery murder in san francisco tonight, cinematic and calm, words on screen, end on a question, about 30 seconds",
    false,
    ["feel", "words"],
    connectedSourceAnswers
  );
  assert.equal(question?.id, "visuals");
  assert.deepEqual(question?.choices, connectedSourceAnswers.choices);
  assert.equal(question?.prompt, "Do you have photos, or should I use pictures from Pexels or FAL?");
  assert.doesNotMatch(question?.prompt ?? "", /Civitai/i);
  const falOnly = briefQuestionFor("visuals", "mystery murder in san francisco", false, {
    choices: ["AI images with FAL (paid, asks first)", "Use my photos"],
    connected: ["FAL"],
    hint: "Connect Pexels and Civitai in Settings to use them here."
  });
  assert.match(falOnly.prompt, /pictures of San Francisco from FAL/);
  assert.match(falOnly.prompt, /Connect Pexels and Civitai in Settings to use them here\./);
  assert.doesNotMatch(falOnly.prompt, /Pexels videos of/);
});

test("a studio with only own photos is never asked where pictures come from", () => {
  const conversation =
    "mystery murder in san francisco tonight, cinematic and calm, words on screen, end on a question, about 30 seconds";
  assert.equal(nextBriefQuestion(conversation, false, [], ownOnlySourceAnswers), undefined);
  assert.notEqual(nextBriefQuestion(conversation, false, ["feel"], ownOnlySourceAnswers)?.id, "visuals");
  const ready = briefReadyMessage(conversation, ownOnlySourceAnswers);
  assert.match(ready, /use your photos\./);
  assert.doesNotMatch(ready, /Pexels/);
});

test("source answers are read back as the pictures that will really be used", () => {
  const plan = recommendVideoArchitecture("harbor night");
  assert.equal(briefWhereFromChat("harbor night\nCivitai images", plan), "Civitai images");
  assert.equal(
    briefWhereFromChat("harbor night\nAI images with FAL (paid, asks first)", plan),
    "AI images from your FAL key"
  );
  // Chats saved before the label changed still read back the same way.
  assert.equal(
    briefWhereFromChat("harbor night\nAI stills with FAL (paid, asks first)", plan),
    "AI images from your FAL key"
  );
  assert.equal(
    briefWhereFromChat("harbor night\nMix my photos and Pexels and FAL", plan),
    "your photos and Pexels and FAL"
  );
  assert.equal(briefWhereFromChat("harbor night\nUse my photos", plan), "your photos");
  assert.equal(briefWhereFromChat("harbor night\nPexels videos", plan), "Pexels videos");
  assert.match(
    briefReadyMessage("harbor night\nCivitai images", {
      choices: ["Civitai images", "Use my photos"],
      connected: ["Civitai"],
      hint: ""
    }),
    /use Civitai images\./
  );
});

test("Civitai and FAL answers count as the picture answer", () => {
  for (const answer of ["Civitai images", "AI images with FAL (paid, asks first)"]) {
    const conversation = `harbor night\n${answer}`;
    assert.equal(answeredBriefQuestions(conversation, false).has("visuals"), true);
    // So the chat never asks where the pictures come from after that answer.
    assert.notEqual(nextBriefQuestion(conversation, false, ["feel"])?.id, "visuals");
  }
  assert.equal(isBriefAnswerLine("Mix my photos and Pexels and FAL"), true);
  assert.equal(isBriefAnswerLine("AI images with FAL (paid, asks first)"), true);
  // The older label is still an answer, not a topic.
  assert.equal(isBriefAnswerLine("AI stills with FAL (paid, asks first)"), true);
  // An audience chip from an older chat is an answer too, never the subject.
  assert.equal(isBriefAnswerLine("General viewers"), true);
  assert.equal(isBriefAnswerLine("harbor night"), false);
  // The labels on the question that comes with photos never name the video.
  assert.equal(isBriefAnswerLine("Just what the photos show"), true);
  assert.equal(isBriefAnswerLine("A story around them"), true);
  assert.equal(
    briefPurposeFromChat("I added 1 photo.\nI looked at 1 photo: landscape.\nA story around them", 1),
    "Video from 1 photo"
  );
  assert.equal(briefPurposeFromChat("harbor night\nMix my photos and Pexels and FAL"), "harbor night");
  assert.equal(briefPurposeFromChat("harbor night\nGeneral viewers"), "harbor night");
});

const ids = () => {
  let value = 0;
  return () => `scene-${++value}`;
};

test("every photo the owner added gets its own scene", () => {
  const photos = ["A red boat on the harbor", "", "Kids running through the square", "Rain on the window", "A lamp in the fog", "Two shoes by the door"];
  const scenes = buildStoryboardDraft("Video from 6 photos", ids(), undefined, {
    ownMediaCount: 6,
    photoNotes: photos
  });
  assert.equal(scenes.length, 6);
  assert.deepEqual(scenes.map(({ caption }) => caption), [
    "A red boat on the harbor.",
    "",
    "Kids running through the square.",
    "Rain on the window.",
    "A lamp in the fog.",
    "Two shoes by the door."
  ]);
  // The placeholder purpose never reaches a card.
  assert.doesNotMatch(scenes.map(({ caption }) => caption).join("\n"), /Video from 6 photos/iu);
  assert.doesNotMatch(scenes.map(({ visual_prompt }) => visual_prompt).join("\n"), /Video from 6 photos/iu);
  // More photos than the plan holds grows the storyboard, never fewer photos.
  const eight = buildStoryboardDraft("Video from 8 photos", ids(), recommendVideoArchitecture("Video from 8 photos"), {
    ownMediaCount: 8
  });
  assert.equal(eight.length, 8);
  assert.ok(eight.every(({ duration_ms }) => duration_ms >= 500));
});

test("a brief that asks for no words keeps every caption empty", () => {
  const scenes = buildStoryboardDraft("A lighthouse keeps flashing on an empty island", ids(), undefined, {
    ownMediaCount: 3,
    photoNotes: ["A red boat on the harbor", "Kids running through the square", "Rain on the window"],
    wordsOnScreen: "none"
  });
  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map(({ caption }) => caption), ["", "", "", ""]);
  assert.equal(briefWantsWordsOnScreen("A lighthouse, no words at all"), false);
  assert.equal(briefWantsWordsOnScreen("A lighthouse with words on screen"), true);
});

test("photo notes stay with their own photo and only fill empty captions", () => {
  assert.deepEqual(
    photoNotesFromCaptions({ captions: [{ caption: "  A red   boat " }, { caption: "" }, { caption: "Kids running" }] }),
    ["A red boat", "", "Kids running"]
  );
  const scenes = [
    { id: "one", caption: "A lighthouse at dawn." },
    { id: "two", caption: "" },
    { id: "three", caption: "  " }
  ];
  const filled = withPhotoCaptions(scenes, ["A red boat", "Kids running", "Rain on the window"], "A lighthouse at dawn");
  assert.deepEqual(filled.map(({ caption }) => caption), [
    "A lighthouse at dawn.",
    "Kids running",
    "Rain on the window"
  ]);
  assert.deepEqual(filled.map(({ id }) => id), ["one", "two", "three"]);
  // Nothing is invented without a brief that keeps words, or without notes.
  assert.deepEqual(
    withPhotoCaptions(scenes, ["A red boat", "Kids running", "Rain on the window"], "A lighthouse at dawn, no words at all")
      .map(({ caption }) => caption),
    ["A lighthouse at dawn.", "", "  "]
  );
  assert.deepEqual(withPhotoCaptions(scenes, [], "A lighthouse at dawn").map(({ caption }) => caption),
    ["A lighthouse at dawn.", "", "  "]);
});

test("the photo description price is shown at the pinned rate before the read", () => {
  assert.equal(photoCaptionEstimateUsd(0), 0);
  assert.equal(photoCaptionEstimateUsd(1), 0.0012);
  // The cap is eight photos per read, so more photos never cost more.
  assert.equal(photoCaptionEstimateUsd(8), 0.0096);
  assert.equal(photoCaptionEstimateUsd(40), 0.0096);
  assert.equal(
    photoCaptionConfirmText(1),
    "Describe 1 photo with your FAL key? Up to about 1 cent at the pinned price."
  );
  assert.equal(
    photoCaptionConfirmText(40),
    "Describe 8 photos with your FAL key? Up to about 1 cent at the pinned price."
  );
});

test("chip answers stay in the brief as details, never as the subject", () => {
  assert.deepEqual(
    briefDetailLines("mystery murder in san francisco\nWarm and calm\nNo words at all\nEnd on a question"),
    ["mystery murder in san francisco", "Warm and calm", "No words at all", "End on a question"]
  );
  assert.equal(
    briefPurposeFromChat("mystery murder in san francisco\nWarm and calm\nNo words at all"),
    "mystery murder in san francisco. Warm and calm. No words at all"
  );
  // With photos and no words, what the photos show is the brief.
  assert.equal(briefPurposeFromChat("I looked at 2 photos. File names: sf alley.", 2, ["A red boat", "Rain on the window"]), "A red boat Rain on the window");
  assert.equal(briefPurposeFromChat("", 3), "Video from 3 photos");
});

test("a question answered in the owner's own words never replaces the subject", () => {
  const details =
    "mystery murder in san francisco\ntonight, warm and calm, words on screen, end on a question, about 30 seconds";
  assert.deepEqual(briefDetailLines(details), [
    "mystery murder in san francisco",
    "tonight, warm and calm, words on screen, end on a question, about 30 seconds"
  ]);
  assert.match(briefPurposeFromChat(details), /^mystery murder in san francisco\. tonight, warm and calm/u);
  assert.match(briefReadyMessage(details), /The subject is mystery murder in san francisco\./u);
  // A sentence about the video is detail, not the thing the video is about.
  assert.equal(
    briefDetailLines("mystery murder in san francisco\nit should feel warm and calm, like an old film")[0],
    "mystery murder in san francisco"
  );
  // A short feel answer with extra texture is still an answer.
  assert.equal(
    briefDetailLines("mystery murder in san francisco\nWarm and calm, like an old film")[0],
    "mystery murder in san francisco"
  );
  // A subject that happens to use answer words keeps its place.
  assert.deepEqual(briefDetailLines("Summer beach, the old pier"), ["Summer beach, the old pier"]);
  // Answers alone still make a brief instead of an empty one.
  assert.equal(briefPurposeFromChat("Warm and calm"), "Warm and calm");
});


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
  assert.deepEqual(scenes.map(({ caption }) => caption), [
    "A lonely island waits in black water.",
    "A lighthouse flashes without a keeper.",
    "Footprints cross the wet sand.",
    "Then vanish at the sealed door."
  ]);
  assert.doesNotMatch(scenes.map(({ caption }) => caption).join("\n"), /^(?:make|create|build)\b/imu);
});

test("one sentence uses visible four-role prompts without repeating captions", () => {
  const brief = "A mysterious island rises from the ocean at dawn";
  const scenes = buildStoryboardDraft(brief, ids());
  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map(({ caption }) => caption), ["A mysterious island rises from the ocean at dawn.", "", "", ""]);
  assert.match(scenes[0].visual_prompt, /wide establishing view$/);
  assert.match(scenes[3].visual_prompt, /closing wide shot$/);
});

test("a short cinematic phrase stays one speakable caption, not one word per scene", () => {
  const scenes = buildStoryboardDraft("cosmic dust space travel", ids());
  assert.equal(scenes.length, 4);
  assert.deepEqual(scenes.map(({ caption }) => caption), ["Cosmic dust space travel.", "", "", ""]);
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
  assert.deepEqual(short.map(({ caption }) => caption), ["Hi.", "", "", ""]);
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

test("deleteProject hard-deletes via DELETE and returns storage cleanup result", async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    seen.push({ url: String(input), method: init.method ?? "GET", auth: new Headers(init.headers).get("authorization") });
    return new Response(JSON.stringify({
      project_id: "draft-1",
      deleted: true,
      storage_failures: ["projects/draft-1/media-sealed/a"]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = new ApiClient(() => "tok");
    assert.deepEqual(await client.deleteProject("draft-1"), {
      project_id: "draft-1",
      deleted: true,
      storage_failures: ["projects/draft-1/media-sealed/a"]
    });
    assert.deepEqual(seen, [{
      url: "/api/projects/draft-1",
      method: "DELETE",
      auth: "Bearer tok"
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a late response from an older revision never replaces a newer project", () => {
  const newer = { id: "p1", revision: 5, brief: { soundtrack: null }, scenes: [] };
  const older = { id: "p1", revision: 4, brief: { soundtrack: null }, scenes: [] };
  assert.equal(newerSnapshot(newer, older), newer);
  assert.equal(newerSnapshot(older, newer), newer);
  const same = { ...newer, brief: { soundtrack: { kind: "stock", stock_id: "pulse", bpm: 101, offset_ms: 0, level: 0.6 } } };
  assert.equal(newerSnapshot(newer, same), same);
  const otherProject = { ...older, id: "p2" };
  assert.equal(newerSnapshot(newer, otherProject), otherProject);
  assert.equal(newerSnapshot(undefined, otherProject), otherProject);
});
