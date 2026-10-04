import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";
import { ensureSpokenVoiceover } from "../dist/spoken-narration.js";
import { SPEECH_SAMPLE_RATE, synthesizeSpeech, wavPcm } from "../dist/speech-wav.js";

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

test("spoken speech is audible and lines up with the spoken scene", () => {
  const wav = synthesizeSpeech("Read the full post.");
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString("ascii"), "RIFF");
  const { sampleRate, samples } = wavPcm(wav);
  assert.equal(sampleRate, SPEECH_SAMPLE_RATE);
  assert.ok(samples.length > sampleRate * 0.4);
  assert.ok(rms(samples, 0, samples.length) > 200);
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
  let synthesized = 0;
  const synthesize = (text) => {
    synthesized += 1;
    return synthesizeSpeech(text);
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
  assert.equal(synthesized, 1);
  assert.equal(first.project.brief.voiceover.level, 1);
  assert.ok(first.project.brief.voiceover.spoken_key);
  const mix = wavPcm(audio.files.get(first.project.brief.voiceover.media_id));
  const scene5 = SPEECH_SAMPLE_RATE * 3;
  assert.ok(rms(mix.samples, scene5, SPEECH_SAMPLE_RATE) > rms(mix.samples, 0, SPEECH_SAMPLE_RATE));

  const puts = audio.puts();
  const second = await ensureSpokenVoiceover("owner", first.project, audio, save, synthesize);
  assert.equal(second.generated, 0);
  assert.equal(synthesized, 1);
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
  assert.equal(synthesized, 1);
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
  assert.equal(synthesized, 2);
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
  assert.equal(synthesized, 2);
  assert.equal(kept.project.brief.voiceover.media_id, "user-take");
});

test("spoken narration route attaches on open and does not store again on reopen", async () => {
  const projects = new ProjectService();
  const audio = memoryAudio();
  const server = createServer(createTestApp({ ownerId: "owner", projects, spokenAudio: audio }));
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
    assert.ok(opened.project.brief.voiceover.media_id);
    assert.equal(Buffer.from(audio.files.get(opened.project.brief.voiceover.media_id).subarray(0, 4)).toString("ascii"), "RIFF");
    const puts = audio.puts();
    const second = await fetch(`${origin}/api/projects/${project.id}/spoken-narration`, { method: "POST" });
    assert.equal(second.status, 200);
    const reopened = await second.json();
    assert.equal(reopened.generated, 0);
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
