import test from "node:test";
import assert from "node:assert/strict";
import { applyCommand } from "../dist/index.js";
import {
  spokenLineKey,
  spokenLinesToGenerate,
  spokenMixKey,
  spokenNarrationReady
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
