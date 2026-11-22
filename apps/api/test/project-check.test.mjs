import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spokenLineKey } from "@f-engine/reel-engine";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";
import { checkFactsFor } from "../dist/project-check.js";
import { encodeWav } from "../dist/speech-wav.js";

const OWNER = "authenticated-user";

function scene(id, extra = {}) {
  return {
    id,
    order: 0,
    caption: "Read the full post.",
    duration_ms: 3_000,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "none",
    audio_level: 1,
    ducking: false,
    visual_prompt: "calm studio desk",
    ...extra
  };
}

function snapshot(scenes, spoken = []) {
  return {
    schema_version: 1,
    id: "project-1",
    owner_id: OWNER,
    revision: 1,
    brief: { purpose: "Check", ...(spoken.length ? { spoken_audio: spoken } : {}) },
    scenes
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("check facts report a deleted media row and a measured take", async () => {
  const caption = "Read the full post.";
  const wav = encodeWav(new Int16Array(24_000 * 2), 24_000);
  const facts = await checkFactsFor(
    OWNER,
    snapshot(
      [scene("s1", { media_id: "photo", overlay_look: "spoken" })],
      [{ role: "line", key: spokenLineKey(caption), media_id: "take" }]
    ),
    {
      media: { async get() { return undefined; } },
      spokenAudio: { async readWav() { return wav; } }
    }
  );
  assert.deepEqual(facts.media, { photo: { state: "missing" } });
  assert.equal(Math.round(facts.spoken_takes.s1), 2_000);
});

test("check facts skip a take that storage cannot read", async () => {
  const caption = "Read the full post.";
  const facts = await checkFactsFor(
    OWNER,
    snapshot(
      [scene("s1", { overlay_look: "spoken" })],
      [{ role: "line", key: spokenLineKey(caption), media_id: "take" }]
    ),
    {
      spokenAudio: {
        async readWav() {
          throw new Error("storage unavailable");
        }
      }
    }
  );
  assert.deepEqual(facts.spoken_takes, {});
  assert.equal(facts.media, undefined);
});

test("GET /api/projects/:projectId/check reports errors without starting a render", async () => {
  const caption = "a".repeat(20);
  const projects = new ProjectService();
  const project = await projects.create(OWNER, {
    purpose: "Check",
    spoken_audio: [{ role: "line", key: spokenLineKey("Read the full post."), media_id: "take" }]
  });
  await projects.command(OWNER, {
    command_id: "seed",
    project_id: project.id,
    base_revision: project.revision,
    client_timestamp: "",
    kind: "replace_storyboard",
    payload: {
      scenes: [
        scene("long-word", { order: 0, caption, media_id: "deleted-photo", overlay_look: "spoken" }),
        scene("spoken", {
          order: 1,
          caption: "Read the full post.",
          overlay_look: "spoken",
          duration_ms: 500,
          media_id: "take-photo"
        })
      ]
    }
  });

  const server = createServer(createTestApp({
    projects,
    media: {
      repository: {
        async get(_ownerId, _projectId, id) {
          return id === "take-photo" ? { state: "ready" } : undefined;
        }
      },
      store: {}
    },
    spokenAudio: {
      async readWav() {
        return encodeWav(new Int16Array(24_000 * 2), 24_000);
      }
    }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/projects/${project.id}/check`);
    assert.equal(response.status, 200);
    const report = await response.json();
    const codes = report.errors.map((entry) => `${entry.code}:${entry.scene_id}`);
    assert.deepEqual(codes, [
      "media_missing:long-word",
      "overlay_overflow:long-word",
      "spoken_take_overrun:spoken"
    ]);
    assert.deepEqual(report.warnings, []);

    const alias = await fetch(`${origin}/v1/projects/${project.id}/check`);
    assert.equal(alias.status, 200);
    assert.deepEqual((await alias.json()).errors, report.errors);

    const other = createServer(createTestApp({ ownerId: "someone-else" }));
    const otherOrigin = await listen(other);
    try {
      const missing = await fetch(`${otherOrigin}/api/projects/${project.id}/check`);
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).type, "not_found");
    } finally {
      await new Promise((resolve, reject) => other.close((error) => error ? reject(error) : resolve()));
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
