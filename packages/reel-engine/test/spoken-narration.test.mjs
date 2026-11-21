import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../dist/index.js";
import {
  SPOKEN_CUE_DRIFT_MS,
  SPOKEN_TAKE_MAX_MS,
  SPOKEN_TAKE_PAD_MS,
  SPOKEN_VOICE,
  spokenLineKey,
  spokenLinesToGenerate,
  spokenMixKey,
  spokenNarrationReady,
  spokenSceneMsForTake,
  spokenSceneTiming,
  spokenTakeCues
} from "../dist/spoken-narration.js";

const spoken = (id, caption, duration_ms = 6000) => ({
  id,
  order: 0,
  caption,
  duration_ms,
  focal_x: 0.5,
  focal_y: 0.5,
  motion: "zoom",
  audio_level: 1,
  ducking: false,
  overlay_look: "spoken",
  overlay_place: "center",
  visual_prompt: "A painted figure"
});

test("spoken line keys ignore case and a second open of the same line needs no new speech", () => {
  const scenes = [spoken("s5", "Read the full post.")];
  assert.deepEqual(SPOKEN_VOICE, {
    endpoint: "fal-ai/kokoro/american-english",
    voice: "af_heart",
    speed: 1
  });
  const first = spokenLineKey("A room that agreed to forget the street for a while.");
  const later = spokenLineKey("The night already had a script.");
  assert.notEqual(first, later);
  assert.equal(spokenLineKey("A room that agreed to forget the street for a while."), first);
  const key = spokenLineKey("Read the full post.");
  assert.equal(spokenLineKey("  read   the full post. "), key);
  assert.equal(spokenLinesToGenerate(
    [{ text: "Read the full post.", key, startMs: 0, durationMs: 6000 }],
    [key]
  ).length, 0);
  assert.deepEqual(spokenLinesToGenerate(
    [{ text: "Read the full post.", key, startMs: 0, durationMs: 6000 }],
    []
  ), [key]);
  const mix = spokenMixKey(scenes);
  assert.equal(spokenMixKey(scenes), mix);
  assert.notEqual(spokenMixKey([spoken("s5", "Read the full post.", 5000)]), mix);
  assert.equal(spokenNarrationReady({ scenes, brief: {} }), false);
  assert.equal(spokenNarrationReady({
    scenes,
    brief: { voiceover: { spoken_key: mix } }
  }), true);
  assert.equal(spokenNarrationReady({
    scenes,
    brief: { voiceover: { media_id: "upload" } }
  }), true);
  assert.equal(spokenNarrationReady({
    scenes: [{ ...scenes[0], overlay_look: "caption" }],
    brief: {}
  }), true);
});

test("a take sets the spoken scene length, with its own cue window", () => {
  assert.equal(spokenSceneMsForTake(1_500), 1_500 + SPOKEN_TAKE_PAD_MS);
  assert.equal(spokenSceneMsForTake(1_500.4), 1_501 + SPOKEN_TAKE_PAD_MS);
  // A short take still gets the smallest scene, and the clamp still caps a long one.
  assert.equal(spokenSceneMsForTake(120), 500);
  assert.equal(spokenSceneMsForTake(SPOKEN_TAKE_MAX_MS - SPOKEN_TAKE_PAD_MS), SPOKEN_TAKE_MAX_MS);
  // A take past the clamp is an error: resampling it would change its pitch.
  assert.equal(SPOKEN_TAKE_MAX_MS, 15_000);
  assert.throws(() => spokenSceneMsForTake(15_001), /over the 15000ms scene limit/);
  assert.throws(() => spokenSceneMsForTake(0), /has no audio/);

  // The fallback is one cue: the line starts with the audio and ends with it.
  const caption = "Read the full post.";
  assert.deepEqual(spokenTakeCues(caption, 1_500), [{ text: caption, start_ms: 0, end_ms: 1_500 }]);
  // A schedule the editor already wrote inside the take is kept, split and all.
  const kept = [
    { text: "Read the full", start_ms: 0, end_ms: 800 },
    { text: "post.", start_ms: 800, end_ms: 1_480 }
  ];
  assert.deepEqual(spokenTakeCues(caption, 1_500, kept), kept);
  // A stale schedule, or one that runs past the take, is replaced by the take.
  assert.deepEqual(
    spokenTakeCues(caption, 1_500, [{ text: "Older line.", start_ms: 0, end_ms: 1_480 }]),
    [{ text: caption, start_ms: 0, end_ms: 1_500 }]
  );
  assert.deepEqual(
    spokenTakeCues(caption, 1_500, [{ text: caption, start_ms: 0, end_ms: 4_000 }]),
    [{ text: caption, start_ms: 0, end_ms: 1_500 }]
  );
  // A schedule far enough from the take is also replaced, inside a tolerance it is kept.
  assert.deepEqual(spokenTakeCues(caption, 1_500, [{ text: caption, start_ms: 0, end_ms: 1_500 - SPOKEN_CUE_DRIFT_MS - 1 }]), [
    { text: caption, start_ms: 0, end_ms: 1_500 }
  ]);
  assert.deepEqual(
    spokenTakeCues(caption, 1_500, [{ text: caption, start_ms: 0, end_ms: 1_500 - SPOKEN_CUE_DRIFT_MS + 1 }]),
    [{ text: caption, start_ms: 0, end_ms: 1_500 - SPOKEN_CUE_DRIFT_MS + 1 }]
  );
});

test("spoken scene timing reaches the snapshot through update_voiceover", () => {
  const snapshot = {
    schema_version: 1,
    id: "p",
    owner_id: "owner",
    revision: 0,
    brief: { purpose: "Night", audience: "Viewers", tone: "Calm" },
    scenes: [spoken("s5", "Read the full post.", 6000)]
  };
  const timing = spokenSceneTiming(snapshot.scenes[0], 1_500);
  assert.deepEqual(timing, {
    id: "s5",
    duration_ms: 1_620,
    caption_cues: [{ text: "Read the full post.", start_ms: 0, end_ms: 1_500 }]
  });
  const key = spokenMixKey(snapshot.scenes);
  const updated = applyCommand(snapshot, {
    command_id: "vo",
    project_id: "p",
    base_revision: 0,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: {
      voiceover: { media_id: "mix-1", offset_ms: 0, level: 1, spoken_key: key },
      scene_timing: [timing]
    }
  });
  assert.equal(updated.scenes[0].duration_ms, 1_620);
  assert.deepEqual(updated.scenes[0].caption_cues, timing.caption_cues);
  // The measured length is part of the mix fingerprint, so the old guess never matches.
  assert.notEqual(spokenMixKey(updated.scenes), key);

  const again = { ...snapshot, revision: updated.revision };
  const command = (payload) => ({
    command_id: `c-${payload.id ?? "x"}`,
    project_id: "p",
    base_revision: again.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: { voiceover: null, ...payload }
  });
  assert.throws(
    () => applyCommand(again, command({ scene_timing: [{ id: "missing", duration_ms: 1_000, caption_cues: [] }] })),
    /unknown scene/
  );
  assert.throws(
    () => applyCommand(again, command({ scene_timing: [{ id: "s5", duration_ms: 20_000, caption_cues: [] }] })),
    /duration out of bounds/
  );
  const captionScene = {
    ...snapshot,
    revision: again.revision,
    scenes: [{ ...snapshot.scenes[0], overlay_look: "caption" }]
  };
  assert.throws(
    () => applyCommand(captionScene, command({ scene_timing: [timing] })),
    /invalid scene timing/
  );
});

test("update_voiceover keeps spoken narration cache when the file is cleared", () => {
  const snapshot = {
    schema_version: 1,
    id: "p",
    owner_id: "owner",
    revision: 0,
    brief: { purpose: "Night", audience: "Viewers", tone: "Calm" },
    scenes: [{ ...spoken("s5", "Read the full post."), order: 0 }]
  };
  const key = spokenMixKey(snapshot.scenes);
  const withVoice = applyCommand(snapshot, {
    command_id: "vo",
    project_id: "p",
    base_revision: 0,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: {
      voiceover: { media_id: "mix-1", offset_ms: 0, level: 1, spoken_key: key },
      spoken_audio: [
        { role: "line", key: spokenLineKey("Read the full post."), media_id: "line-1" },
        { role: "mix", key, media_id: "mix-1" }
      ]
    }
  });
  assert.equal(withVoice.brief.voiceover.spoken_key, key);
  assert.equal(withVoice.brief.spoken_audio.length, 2);
  const cleared = applyCommand(withVoice, {
    command_id: "clear",
    project_id: "p",
    base_revision: 1,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: { voiceover: null }
  });
  assert.equal(cleared.brief.voiceover, undefined);
  assert.equal(cleared.brief.spoken_audio[0].media_id, "line-1");
});
