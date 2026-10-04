import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";
import { SPOKEN_VOICE, spokenLineKey, spokenLineSlots, spokenTimelineMs } from "@f-engine/reel-engine";
import { ensureSpokenVoiceover } from "../dist/spoken-narration.js";
import { encodeWav, fitTakeToScene, mixSpokenTimeline, synthesizeSpeech, wavPcm } from "../dist/speech-wav.js";

function scene(id, caption, extra = {}) {
  return {
    id,
    order: 0,
    caption,
    visual_prompt: "A painted figure",
    duration_ms: 4000,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "zoom",
    audio_level: 1,
    ducking: false,
    overlay_look: "spoken",
    overlay_place: "center",
    ...extra
  };
}

function memoryAudio() {
  const files = new Map();
  let puts = 0;
  return {
    puts: () => puts,
    files,
    async putWav(_ownerId, _projectId, bytes) {
      puts += 1;
      const id = `wav-${puts}`;
      files.set(id, bytes);
      return id;
    },
    async readWav(_ownerId, _projectId, mediaId) {
      return files.get(mediaId);
    }
  };
}

function rms(samples, start, count) {
  let energy = 0;
  const end = Math.min(samples.length, start + count);
  const length = Math.max(1, end - start);
  for (let i = start; i < end; i += 1) energy += samples[i] * samples[i];
  return Math.sqrt(energy / length);
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function voiceWav(text, long = false) {
  const samples = new Int16Array(long ? 48_000 : 2_400);
  samples.fill(8_000 + text.length);
  samples[samples.length - 1] = 30_000;
  return encodeWav(samples, 24_000);
}

test("a long take keeps its tail in the scene and a short take keeps its length", () => {
  const long = new Int16Array(400);
  long.fill(1_000);
  long[399] = 30_000;
  const fitted = fitTakeToScene(long, 16_000, 16_000, 50);
  assert.equal(fitted.length, 50);
  assert.equal(fitted[49], 30_000);
  assert.notEqual(fitted[49], long[49]);
  const short = Int16Array.from([3, 4, 5]);
  assert.deepEqual([...fitTakeToScene(short, 16_000, 16_000, 10)], [3, 4, 5]);
});

test("retired formant speech is a 16 kHz mix and is not the played voice", () => {
  const wav = synthesizeSpeech("A room that agreed to forget the street for a while.");
  const { sampleRate, samples } = wavPcm(wav);
  assert.equal(sampleRate, 16_000);
  assert.ok(rms(samples, 0, samples.length) > 200);
  const played = voiceWav("A room that agreed to forget the street for a while.");
  assert.notEqual(wavPcm(played).sampleRate, sampleRate);
  assert.notDeepEqual(Buffer.from(played), Buffer.from(wav));
});

test("opening spoken captions stores narration once and a second open does not synthesize", async () => {
  const projects = new ProjectService();
  const created = projects.create("owner", { purpose: "The night already had a script", audience: "Viewers", tone: "Calm" });
  const replaced = projects.command("owner", {
    command_id: "board",
    project_id: created.id,
    base_revision: created.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: {
      scenes: [
        scene("s4", "Selected gallery image 4", { overlay_look: "caption", duration_ms: 3000, order: 0 }),
        scene("s5", "Read the full post.", { order: 1, duration_ms: 6000 })
      ]
    }
  });
  const audio = memoryAudio();
  const calls = [];
  const synthesize = async (request) => {
    calls.push(request);
    return voiceWav(request.text);
  };
  const save = (base, voiceover, spokenAudio) => projects.command("owner", {
    command_id: `save-${base.revision}`,
    project_id: base.id,
    base_revision: base.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: { voiceover, spoken_audio: spokenAudio }
  });
  const first = await ensureSpokenVoiceover("owner", replaced, audio, save, synthesize);
  assert.equal(first.generated, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, "Read the full post.");
  assert.deepEqual(
    { endpoint: calls[0].endpoint, voice: calls[0].voice, speed: calls[0].speed },
    SPOKEN_VOICE
  );
  assert.equal(first.project.brief.voiceover.level, 1);
  assert.ok(first.project.brief.voiceover.spoken_key);
  const mix = wavPcm(audio.files.get(first.project.brief.voiceover.media_id));
  const scene5 = mix.sampleRate * 3;
  assert.ok(rms(mix.samples, scene5, mix.sampleRate) > rms(mix.samples, 0, mix.sampleRate));
  assert.notEqual(mix.sampleRate, wavPcm(synthesizeSpeech("Read the full post.")).sampleRate);

  const puts = audio.puts();
  const second = await ensureSpokenVoiceover("owner", first.project, audio, save, synthesize);
  assert.equal(second.generated, 0);
  assert.equal(calls.length, 1);
  assert.equal(audio.puts(), puts);
  assert.equal(second.project.revision, first.project.revision);
  assert.equal(second.project.brief.voiceover.media_id, first.project.brief.voiceover.media_id);

  const cleared = projects.command("owner", {
    command_id: "clear-voice",
    project_id: first.project.id,
    base_revision: first.project.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: { voiceover: null }
  });
  const restored = await ensureSpokenVoiceover("owner", cleared, audio, save, synthesize);
  assert.equal(restored.generated, 0);
  assert.equal(calls.length, 1);
  assert.equal(audio.puts(), puts);
  assert.equal(restored.project.brief.voiceover.media_id, first.project.brief.voiceover.media_id);

  const edited = projects.command("owner", {
    command_id: "edit-caption",
    project_id: restored.project.id,
    base_revision: restored.project.revision,
    client_timestamp: "t",
    kind: "update_scene",
    payload: {
      scene: { ...restored.project.scenes[1], caption: "Hear this line." }
    }
  });
  const third = await ensureSpokenVoiceover("owner", edited, audio, save, synthesize);
  assert.equal(third.generated, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].text, "Hear this line.");
  assert.equal(calls[1].voice, calls[0].voice);
  assert.equal(calls[1].speed, calls[0].speed);
  assert.equal(calls[1].endpoint, calls[0].endpoint);
  assert.notEqual(third.project.brief.voiceover.media_id, first.project.brief.voiceover.media_id);

  const owned = projects.command("owner", {
    command_id: "user-voice",
    project_id: third.project.id,
    base_revision: third.project.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: { voiceover: { media_id: "user-take", offset_ms: 120, level: 0.8 } }
  });
  const kept = await ensureSpokenVoiceover("owner", owned, audio, save, synthesize);
  assert.equal(kept.generated, 0);
  assert.equal(calls.length, 2);
  assert.equal(kept.project.brief.voiceover.media_id, "user-take");
});

test("the first spoken line and a later line share one voice, and play is not the formant mix", async () => {
  const projects = new ProjectService();
  const created = projects.create("owner", { purpose: "A quiet room", audience: "Viewers", tone: "Calm" });
  const firstCaption = "A room that agreed to forget the street for a while.";
  const laterCaption = "The night already had a script.";
  const replaced = projects.command("owner", {
    command_id: "board",
    project_id: created.id,
    base_revision: created.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: {
      scenes: [
        scene("s1", "Selected gallery image 4", { overlay_look: "caption", duration_ms: 500, order: 0 }),
        scene("s2", firstCaption, { order: 1, duration_ms: 500 }),
        scene("s3", laterCaption, { order: 2, duration_ms: 4_000 })
      ]
    }
  });
  const audio = memoryAudio();
  const calls = [];
  const takes = new Map();
  const synthesize = async (request) => {
    calls.push(request);
    const wav = voiceWav(request.text, request.text === firstCaption);
    takes.set(request.text, wav);
    return wav;
  };
  const save = (base, voiceover, spokenAudio) => projects.command("owner", {
    command_id: `save-${base.revision}`,
    project_id: base.id,
    base_revision: base.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: { voiceover, spoken_audio: spokenAudio }
  });
  const opened = await ensureSpokenVoiceover("owner", replaced, audio, save, synthesize);
  assert.deepEqual(calls.map((call) => call.text), [firstCaption, laterCaption]);
  assert.ok(calls.every((call) => call.endpoint === SPOKEN_VOICE.endpoint
    && call.voice === SPOKEN_VOICE.voice
    && call.speed === SPOKEN_VOICE.speed));
  assert.equal(calls.some((call) => call.text.includes("\n") || call.text.includes("Selected gallery")), false);
  const lineId = opened.project.brief.spoken_audio.find((item) => item.role === "line" && item.key === spokenLineKey(firstCaption)).media_id;
  assert.deepEqual(Buffer.from(audio.files.get(lineId)), Buffer.from(takes.get(firstCaption)));
  const play = audio.files.get(opened.project.brief.voiceover.media_id);
  const playPcm = wavPcm(play);
  const slotSamples = Math.round((playPcm.sampleRate * 500) / 1000);
  const start = Math.round((playPcm.sampleRate * 500) / 1000);
  assert.equal(playPcm.samples[start + slotSamples - 1], 30_000);
  const formantLines = new Map();
  for (const slot of spokenLineSlots(replaced.scenes)) formantLines.set(slot.key, synthesizeSpeech(slot.text));
  const formant = mixSpokenTimeline(spokenTimelineMs(replaced.scenes), spokenLineSlots(replaced.scenes), formantLines);
  assert.notDeepEqual(Buffer.from(play), Buffer.from(formant));
  assert.notEqual(playPcm.sampleRate, wavPcm(formant).sampleRate);

  const puts = audio.puts();
  const again = await ensureSpokenVoiceover("owner", opened.project, audio, save, synthesize);
  assert.equal(again.generated, 0);
  assert.equal(calls.length, 2);
  assert.equal(audio.puts(), puts);

  calls.length = 0;
  const failing = projects.command("owner", {
    command_id: "edit-later",
    project_id: again.project.id,
    base_revision: again.project.revision,
    client_timestamp: "t",
    kind: "update_scene",
    payload: { scene: { ...again.project.scenes[2], caption: "A later line." } }
  });
  const boom = async (request) => {
    calls.push(request.text);
    if (request.text === "A later line.") throw new Error("provider down");
    return voiceWav(request.text);
  };
  await assert.rejects(() => ensureSpokenVoiceover("owner", failing, audio, save, boom), /provider down/);
  assert.deepEqual(calls, ["A later line."]);
  calls.length = 0;
  const current = projects.get("owner", failing.id);
  const retry = await ensureSpokenVoiceover("owner", current, audio, save, async (request) => {
    calls.push(request.text);
    return voiceWav(request.text);
  });
  assert.deepEqual(calls, ["A later line."]);
  assert.equal(retry.generated, 1);
  assert.equal(retry.project.brief.voiceover.spoken_key.length > 0, true);
});

test("spoken narration route attaches on open and does not store again on reopen", async () => {
  const projects = new ProjectService();
  const audio = memoryAudio();
  const calls = [];
  const spokenSynthesizer = async (request) => {
    calls.push(request);
    return voiceWav(request.text);
  };
  const server = createServer(createTestApp({ ownerId: "owner", projects, spokenAudio: audio, spokenSynthesizer }));
  const origin = await listen(server);
  try {
    const created = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "The night already had a script", audience: "Viewers", tone: "Calm" })
    });
    assert.equal(created.status, 201);
    const { project } = await created.json();
    const replaced = await fetch(`${origin}/api/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "board",
        base_revision: project.revision,
        client_timestamp: "t",
        kind: "replace_storyboard",
        payload: { scenes: [scene("s5", "Read the full post.")] }
      })
    });
    assert.equal(replaced.status, 200);
    const first = await fetch(`${origin}/api/projects/${project.id}/spoken-narration`, { method: "POST" });
    assert.equal(first.status, 200);
    const opened = await first.json();
    assert.equal(opened.generated, 1);
    assert.equal(calls[0].text, "Read the full post.");
    assert.equal(calls[0].voice, SPOKEN_VOICE.voice);
    assert.equal(calls[0].speed, SPOKEN_VOICE.speed);
    assert.ok(opened.project.brief.voiceover.media_id);
    const play = audio.files.get(opened.project.brief.voiceover.media_id);
    assert.equal(Buffer.from(play.subarray(0, 4)).toString("ascii"), "RIFF");
    assert.equal(wavPcm(play).sampleRate, 24_000);
    assert.equal(wavPcm(synthesizeSpeech("Read the full post.")).sampleRate, 16_000);
    const puts = audio.puts();
    const second = await fetch(`${origin}/api/projects/${project.id}/spoken-narration`, { method: "POST" });
    assert.equal(second.status, 200);
    const reopened = await second.json();
    assert.equal(reopened.generated, 0);
    assert.equal(calls.length, 1);
    assert.equal(audio.puts(), puts);
    assert.equal(reopened.project.brief.voiceover.media_id, opened.project.brief.voiceover.media_id);
    assert.equal(reopened.project.revision, opened.project.revision);
    const rejected = await fetch(`${origin}/api/projects/${project.id}/spoken-narration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ charge: true })
    });
    assert.equal(rejected.status, 422);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("spoken narration does not invent a formant voice when FAL is not connected", async () => {
  const projects = new ProjectService();
  const audio = memoryAudio();
  const server = createServer(createTestApp({ ownerId: "owner", projects, spokenAudio: audio }));
  const origin = await listen(server);
  try {
    const created = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "A quiet room", audience: "Viewers", tone: "Calm" })
    });
    const { project } = await created.json();
    const replaced = await fetch(`${origin}/api/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "board",
        base_revision: project.revision,
        client_timestamp: "t",
        kind: "replace_storyboard",
        payload: { scenes: [scene("s5", "Read the full post.")] }
      })
    });
    assert.equal(replaced.status, 200);
    const response = await fetch(`${origin}/api/projects/${project.id}/spoken-narration`, { method: "POST" });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.type, "fal_not_connected");
    assert.equal(body.message.includes("—"), false);
    assert.equal(audio.puts(), 0);
    assert.equal(projects.get("owner", project.id).brief.voiceover, undefined);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
