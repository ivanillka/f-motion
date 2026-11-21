import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";
import { SPOKEN_TAKE_PAD_MS, SPOKEN_VOICE, spokenLineKey, spokenMixKey } from "@f-engine/reel-engine";
import { ensureSpokenVoiceover, spokenVoiceReasonFromError, spokenVoiceStatus, SpokenVoiceUnavailableError } from "../dist/spoken-narration.js";
import { FalImageError, FalProviderError } from "@f-engine/fal-host";
import { encodeWav, measureTake, mixSpokenTimeline, synthesizeSpeech, wavPcm } from "../dist/speech-wav.js";

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

test("a take keeps its own length in the mix and a take that cannot fit fails", () => {
  const wav = voiceWav("Read the full post.");
  const measured = measureTake(wav);
  assert.equal(measured.sampleRate, 24_000);
  assert.equal(Math.round(measured.durationMs), 100);
  // The scene lasts the take plus the breath. The take itself is copied sample for
  // sample, with silence after it: no time-stretch, so the voice keeps its pitch.
  const slot = { key: "k", startMs: 0, durationMs: 220 };
  const mixed = wavPcm(mixSpokenTimeline(220, [slot], new Map([["k", wav]])));
  const take = wavPcm(wav);
  assert.equal(mixed.sampleRate, 24_000);
  assert.equal(mixed.samples.length, Math.round((24_000 * 220) / 1000));
  assert.deepEqual([...mixed.samples.slice(0, take.samples.length)], [...take.samples]);
  assert.ok(mixed.samples.slice(take.samples.length).every((value) => value === 0));
  assert.throws(
    () => mixSpokenTimeline(50, [{ key: "k", startMs: 0, durationMs: 50 }], new Map([["k", wav]])),
    /spoken take overflows its 50ms scene/
  );
});

test("a spoken scene takes its length and cues from the finished take", async () => {
  const takeMs = 1_500;
  const takeWav = () => {
    const samples = new Int16Array((24_000 * takeMs) / 1000);
    samples.fill(900);
    samples[samples.length - 1] = 30_000;
    return encodeWav(samples, 24_000);
  };
  const projects = new ProjectService();
  const created = projects.create("owner", { purpose: "A quiet room", audience: "Viewers", tone: "Calm" });
  const replaced = projects.command("owner", {
    command_id: "board",
    project_id: created.id,
    base_revision: created.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: {
      scenes: [
        // A planner guess that runs past the take is replaced by the take window.
        scene("s1", "Read the full post.", {
          order: 0,
          duration_ms: 6000,
          caption_cues: [{ text: "Read the full post.", start_ms: 0, end_ms: 6000 }]
        }),
        // A cue window that already fits the take is the editor's, so it is kept.
        scene("s2", "Then open the gallery.", {
          order: 1,
          duration_ms: 6000,
          caption_cues: [{ text: "Then open the gallery.", start_ms: 0, end_ms: takeMs - 10 }]
        })
      ]
    }
  });
  const before = spokenMixKey(replaced.scenes);
  const audio = memoryAudio();
  const save = (base, voiceover, spokenAudio, sceneTiming) => projects.command("owner", {
    command_id: `save-${base.revision}`,
    project_id: base.id,
    base_revision: base.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: {
      voiceover,
      spoken_audio: spokenAudio,
      ...(sceneTiming?.length ? { scene_timing: sceneTiming } : {})
    }
  });
  const opened = await ensureSpokenVoiceover("owner", replaced, audio, save, async () => takeWav());
  assert.deepEqual(
    opened.project.scenes.map(({ duration_ms }) => duration_ms),
    [takeMs + SPOKEN_TAKE_PAD_MS, takeMs + SPOKEN_TAKE_PAD_MS]
  );
  assert.deepEqual(opened.project.scenes[0].caption_cues, [
    { text: "Read the full post.", start_ms: 0, end_ms: takeMs }
  ]);
  assert.deepEqual(opened.project.scenes[1].caption_cues, [
    { text: "Then open the gallery.", start_ms: 0, end_ms: takeMs - 10 }
  ]);
  // The mix key follows the measured length, so a mix made for the guess is not reused.
  assert.notEqual(spokenMixKey(opened.project.scenes), before);
  const play = wavPcm(audio.files.get(opened.project.brief.voiceover.media_id));
  assert.equal(play.sampleRate, 24_000);
  assert.equal(play.samples[takeMs * 24 - 1], 30_000);
  assert.equal(play.samples.length, Math.round(((takeMs + SPOKEN_TAKE_PAD_MS) * 2 * 24_000) / 1000));
  const again = await ensureSpokenVoiceover("owner", opened.project, audio, save, async () => {
    throw new Error("a finished take must not be spoken again");
  });
  assert.equal(again.generated, 0);
  assert.equal(again.project.revision, opened.project.revision);
});

test("a take past the longest scene fails instead of being crushed", async () => {
  const projects = new ProjectService();
  const created = projects.create("owner", { purpose: "A long line", audience: "Viewers", tone: "Calm" });
  const replaced = projects.command("owner", {
    command_id: "board",
    project_id: created.id,
    base_revision: created.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: { scenes: [scene("s1", "Read the full post.")] }
  });
  const audio = memoryAudio();
  const save = (base, voiceover, spokenAudio, sceneTiming) => projects.command("owner", {
    command_id: `save-${base.revision}`,
    project_id: base.id,
    base_revision: base.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: {
      voiceover,
      spoken_audio: spokenAudio,
      ...(sceneTiming?.length ? { scene_timing: sceneTiming } : {})
    }
  });
  const longWav = encodeWav(new Int16Array(24_000 * 15.6), 24_000);
  await assert.rejects(
    () => ensureSpokenVoiceover("owner", replaced, audio, save, async () => longWav),
    /spoken take is 15600ms, over the 15000ms scene limit/
  );
  assert.equal(projects.get("owner", created.id).brief.voiceover, undefined);
  assert.equal(audio.puts(), 1);
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
  const save = (base, voiceover, spokenAudio, sceneTiming) => projects.command("owner", {
    command_id: `save-${base.revision}`,
    project_id: base.id,
    base_revision: base.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: {
      voiceover,
      spoken_audio: spokenAudio,
      ...(sceneTiming?.length ? { scene_timing: sceneTiming } : {})
    }
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
  const save = (base, voiceover, spokenAudio, sceneTiming) => projects.command("owner", {
    command_id: `save-${base.revision}`,
    project_id: base.id,
    base_revision: base.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: {
      voiceover,
      spoken_audio: spokenAudio,
      ...(sceneTiming?.length ? { scene_timing: sceneTiming } : {})
    }
  });
  const opened = await ensureSpokenVoiceover("owner", replaced, audio, save, synthesize);
  assert.deepEqual(calls.map((call) => call.text), [firstCaption, laterCaption]);
  assert.ok(calls.every((call) => call.endpoint === SPOKEN_VOICE.endpoint
    && call.voice === SPOKEN_VOICE.voice
    && call.speed === SPOKEN_VOICE.speed));
  assert.equal(calls.some((call) => call.text.includes("\n") || call.text.includes("Selected gallery")), false);
  const lineId = opened.project.brief.spoken_audio.find((item) => item.role === "line" && item.key === spokenLineKey(firstCaption)).media_id;
  assert.deepEqual(Buffer.from(audio.files.get(lineId)), Buffer.from(takes.get(firstCaption)));
  // Each scene lasts its own take plus the breath, and its cue window is the audio.
  const firstTake = wavPcm(takes.get(firstCaption));
  const laterTake = wavPcm(takes.get(laterCaption));
  const firstMs = Math.ceil(measureTake(takes.get(firstCaption)).durationMs);
  const laterMs = Math.ceil(measureTake(takes.get(laterCaption)).durationMs);
  assert.equal(opened.project.scenes[1].duration_ms, firstMs + SPOKEN_TAKE_PAD_MS);
  assert.deepEqual(opened.project.scenes[1].caption_cues, [
    { text: firstCaption, start_ms: 0, end_ms: Math.round(firstMs) }
  ]);
  assert.equal(opened.project.scenes[2].duration_ms, Math.max(500, laterMs + SPOKEN_TAKE_PAD_MS));
  // The long line no longer fits a 500ms slot by shrinking: it grows the scene and
  // its last sample lands at the end of the take, not at the old slot edge.
  const play = audio.files.get(opened.project.brief.voiceover.media_id);
  const playPcm = wavPcm(play);
  const start = Math.round((playPcm.sampleRate * 500) / 1000);
  assert.equal(playPcm.samples[start + firstTake.samples.length - 1], 30_000);
  // Repeated words keep one take, so the mix is not the retired formant voice.
  const formant = synthesizeSpeech(firstCaption);
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
    assert.equal(body.message.includes("\u2014"), false);
    assert.equal(audio.puts(), 0);
    assert.equal(projects.get("owner", project.id).brief.voiceover, undefined);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("voice status names why a read has no voice without failing it", () => {
  const projects = new ProjectService();
  const created = projects.create("owner", { purpose: "A room that agreed to forget", audience: "Viewers", tone: "Calm" });
  const board = projects.command("owner", {
    command_id: "board",
    project_id: created.id,
    base_revision: created.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: { scenes: [scene("s5", "Read the full post.")] }
  });
  assert.deepEqual(spokenVoiceStatus(board), { attached: false, ready: false, lines: 0 });
  assert.deepEqual(spokenVoiceStatus(board, "preparing"), {
    attached: false, ready: false, lines: 0, reason: "preparing"
  });
  // A provider code is only added while the voice is still missing.
  assert.deepEqual(spokenVoiceStatus(board, "unsafe_output"), {
    attached: false, ready: false, lines: 0, reason: "unsafe_output"
  });
  assert.equal(spokenVoiceReasonFromError(new FalImageError("provider_unavailable")), "provider_unavailable");
  assert.equal(spokenVoiceReasonFromError(new FalImageError("unsafe_output")), "unsafe_output");
  assert.equal(spokenVoiceReasonFromError(new FalImageError("credential")), "credential");
  assert.equal(spokenVoiceReasonFromError(new FalProviderError("unavailable")), "provider_unavailable");
  assert.equal(spokenVoiceReasonFromError(new FalProviderError("credential")), "credential");
  assert.equal(spokenVoiceReasonFromError(new SpokenVoiceUnavailableError()), "not_connected");
  // Anything else still has to reach the caller as a real error.
  assert.equal(spokenVoiceReasonFromError(new Error("boom")), undefined);
});

test("a provider hiccup answers 200 with voice_status and a later open attaches the voice", async () => {
  const projects = new ProjectService();
  const audio = memoryAudio();
  const calls = [];
  let failing = true;
  const spokenSynthesizer = async (request) => {
    calls.push(request);
    if (failing) throw new FalImageError("provider_unavailable");
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
    // A busy Kokoro queue used to surface as a 500 while the host lost the draft.
    const first = await fetch(`${origin}/api/projects/${project.id}/spoken-narration`, { method: "POST" });
    assert.equal(first.status, 200);
    const hiccup = await first.json();
    assert.equal(hiccup.generated, 0);
    assert.deepEqual(hiccup.voice_status, {
      attached: false, ready: false, lines: 0, reason: "provider_unavailable"
    });
    assert.equal(hiccup.project.brief.voiceover, undefined);
    assert.equal(hiccup.project.id, project.id);
    assert.deepEqual(calls.map((call) => call.text), ["Read the full post."]);
    assert.equal(audio.puts(), 0);

    failing = false;
    calls.length = 0;
    const retry = await fetch(`${origin}/api/projects/${project.id}/spoken-narration`, { method: "POST" });
    assert.equal(retry.status, 200);
    const attached = await retry.json();
    assert.deepEqual(calls.map((call) => call.text), ["Read the full post."]);
    assert.equal(calls[0].voice, SPOKEN_VOICE.voice);
    assert.equal(attached.generated, 1);
    assert.deepEqual(attached.voice_status, { attached: true, ready: true, lines: 1 });
    assert.equal(wavPcm(audio.files.get(attached.project.brief.voiceover.media_id)).sampleRate, 24_000);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

/** Counts narration saves so a duplicated take shows up in the assertions. */
class NarratingProjects extends ProjectService {
  constructor() {
    super();
    this.narrationSaves = 0;
  }
  command(ownerId, command) {
    if (command.kind === "update_voiceover") this.narrationSaves += 1;
    return super.command(ownerId, command);
  }
}

test("two overlapping opens share one narration take and store it once", async () => {
  const projects = new NarratingProjects();
  const audio = memoryAudio();
  const calls = [];
  const spokenSynthesizer = async (request) => {
    calls.push(request);
    // A slow queue: the second open arrives while the take is still running.
    await new Promise((resolve) => setTimeout(resolve, 60));
    return voiceWav(request.text);
  };
  const server = createServer(createTestApp({ ownerId: "owner", projects, spokenAudio: audio, spokenSynthesizer }));
  const origin = await listen(server);
  try {
    const created = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Two opens, one take", audience: "Viewers", tone: "Calm" })
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
        payload: { scenes: [scene("s5", "Read the full post.", { duration_ms: 6000 })] }
      })
    });
    assert.equal(replaced.status, 200);
    const open = () => fetch(`${origin}/api/projects/${project.id}/spoken-narration`, { method: "POST" });
    // The open that lost the revision race used to answer 409 conflict while the
    // studio showed an error over a draft that was in fact voiced.
    const [first, second] = await Promise.all([open(), open()]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const bodies = await Promise.all([first.json(), second.json()]);
    for (const body of bodies) {
      assert.equal(body.generated, 1);
      assert.deepEqual(body.voice_status, { attached: true, ready: true, lines: 1 });
      assert.ok(body.project.brief.voiceover.media_id);
    }
    // One line is spoken once and the mix is stored once for both opens.
    assert.deepEqual(calls.map((call) => call.text), ["Read the full post."]);
    assert.equal(audio.puts(), 2);
    assert.equal(projects.narrationSaves, 2);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

