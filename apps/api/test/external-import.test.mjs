import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import {
  externalImportConfigFromEnv,
  parseExternalDraft,
  projectIdForExternalImport
} from "../dist/external-import.js";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("trusted import configuration is all-or-nothing and hosted HTTPS-only", () => {
  assert.equal(externalImportConfigFromEnv({}), undefined);
  assert.throws(() => externalImportConfigFromEnv({ FENGINE_IMPORT_TOKEN: "short" }), /at least 32/);
  assert.throws(() => externalImportConfigFromEnv({
    FENGINE_IMPORT_TOKEN: "x".repeat(32),
    FENGINE_IMPORT_OWNER_ID: "11111111-1111-4111-8111-111111111111",
    FENGINE_WEB_ORIGIN: "http://example.test",
    FENGINE_ENV: "hosted"
  }), /WEB_ORIGIN/);
  const configured = externalImportConfigFromEnv({
    FENGINE_IMPORT_TOKEN: "x".repeat(32),
    FENGINE_IMPORT_OWNER_ID: "11111111-1111-4111-8111-111111111111",
    FENGINE_WEB_ORIGIN: "https://f-motion.example",
    FENGINE_IMPORT_MEDIA_ORIGINS: "https://media.fotium.vip,https://fotium.vip",
    FENGINE_ENV: "hosted"
  });
  assert.deepEqual(configured.mediaOrigins, ["https://media.fotium.vip", "https://fotium.vip"]);
});

test("external drafts validate structured architecture and preserve distinct visual/copy intent", () => {
  const draft = parseExternalDraft({
    external_id: "queue:abc123",
    title: "Portrait collection",
    caption: "A quiet portrait story unfolds. Details reveal the setting.",
    call_to_action: "Open the complete gallery.",
    visual_hint: "editorial portrait photography Prague",
    architecture: { duration_seconds: 30, goal: "promote", audience: "social", structure: "story_arc", tone: "cinematic", pace: "balanced", media: "stock" }
  });
  assert.equal(draft.architecture.durationSeconds, 30);
  assert.equal(draft.source.callToAction, "Open the complete gallery.");
  assert.equal(draft.source.visualHint, "editorial portrait photography Prague");
  assert.deepEqual(parseExternalDraft({
    external_id: "queue:media",
    title: "Media",
    media_urls: ["https://media.fotium.vip/gallery/one.jpg"]
  }).mediaUrls, ["https://media.fotium.vip/gallery/one.jpg"]);
  assert.throws(() => parseExternalDraft({ external_id: "queue:media", title: "Media", media_urls: ["http://localhost/a.jpg"] }), /media_urls/);
  assert.throws(() => parseExternalDraft({ external_id: "bad id", title: "Title" }), /external_id/);
});

test("trusted imports create one editable project and retry idempotently", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const token = "trusted-import-token-that-is-long-enough";
  const projects = new ProjectService();
  const server = createServer(createTestApp({
    projects,
    externalImports: { token, ownerId, webOrigin: "https://f-motion.example", mediaOrigins: [] }
  }));
  const origin = await listen(server);
  const body = {
    external_id: "queue:7e5c",
    title: "Gallery follow-up",
    caption: "A portrait series returns for one final look. The quiet details deserve attention.",
    call_to_action: "Open the full gallery.",
    visual_hint: "editorial portrait photography old city",
    architecture: { duration_seconds: 15, goal: "promote", audience: "social", structure: "story_arc", tone: "cinematic", pace: "balanced", media: "stock" }
  };
  try {
    assert.equal((await fetch(`${origin}/api/integrations/project-imports`, { method: "POST" })).status, 401);
    const request = () => fetch(`${origin}/api/integrations/project-imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const first = await request();
    assert.equal(first.status, 201);
    const created = await first.json();
    assert.equal(created.project_id, projectIdForExternalImport(ownerId, body.external_id));
    assert.equal(created.project_url, `https://f-motion.example/?project=${created.project_id}`);
    const project = projects.get(ownerId, created.project_id);
    assert.equal(project.scenes.length, 4);
    assert.match(project.scenes[0].visual_prompt, /editorial portrait photography/i);
    assert.equal(project.scenes.at(-1).caption, "Open the full gallery.");

    const second = await request();
    assert.equal(second.status, 200);
    assert.equal((await second.json()).project_id, created.project_id);
    assert.equal(projects.list(ownerId).length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a repeated trusted import securely ingests and attaches existing gallery media", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const token = "trusted-import-token-that-is-long-enough";
  const projects = new ProjectService();
  const assets = new Map();
  const repository = {
    async get(owner, project, id) {
      const asset = assets.get(id);
      return asset?.ownerId === owner && asset?.projectId === project ? structuredClone(asset) : undefined;
    },
    async insert(asset) { assets.set(asset.id, structuredClone(asset)); },
    async completeAdmission(owner, project, id) {
      const asset = assets.get(id);
      if (!asset || asset.ownerId !== owner || asset.projectId !== project) return false;
      assets.set(id, { ...asset, state: "inspecting" });
      return true;
    }
  };
  const stored = [];
  const store = {
    async put(key, body, type, bytes) {
      let total = 0;
      for await (const chunk of body) total += chunk.byteLength;
      assert.equal(total, bytes);
      stored.push({ key, type, bytes });
    }
  };
  const requested = [];
  const server = createServer(createTestApp({
    projects,
    media: { repository, store },
    externalImports: {
      token,
      ownerId,
      webOrigin: "https://f-motion.example",
      mediaOrigins: ["https://media.fotium.vip"]
    },
    externalMediaRequest: async (input, init) => {
      requested.push({ input: String(input), redirect: init?.redirect });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg", "content-length": "3" }
      });
    }
  }));
  const origin = await listen(server);
  const baseBody = {
    external_id: "followup:gallery-1",
    title: "Gallery follow-up",
    caption: "One final look at the portrait series.",
    call_to_action: "Open the full gallery.",
    architecture: { duration_seconds: 15, media: "own" }
  };
  const request = (body) => fetch(`${origin}/api/integrations/project-imports`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  try {
    assert.equal((await request({
      ...baseBody,
      caption: "One final look. Open the gallery: https://fotium.vip/galleries/portrait"
    })).status, 201);
    const repaired = await request({
      ...baseBody,
      media_urls: [
        "https://media.fotium.vip/galleries/portrait/full/1.jpg",
        "https://media.fotium.vip/galleries/portrait/full/2.jpg"
      ]
    });
    assert.equal(repaired.status, 200);
    const projectId = (await repaired.json()).project_id;
    const project = projects.get(ownerId, projectId);
    assert.equal(project.revision, 2);
    assert.equal(project.scenes.length, 4);
    assert.ok(project.scenes.every((scene) => scene.media_id));
    assert.notEqual(project.scenes[0].media_id, project.scenes[1].media_id);
    assert.equal(project.scenes[0].media_id, project.scenes[2].media_id);
    assert.doesNotMatch(project.scenes.map(({ caption }) => caption).join(" "), /https:\/\//);
    assert.deepEqual(requested.map(({ redirect }) => redirect), ["error", "error"]);
    assert.equal(stored.length, 2);

    const retry = await request({ ...baseBody, media_urls: [
      "https://media.fotium.vip/galleries/portrait/full/1.jpg",
      "https://media.fotium.vip/galleries/portrait/full/2.jpg"
    ] });
    assert.equal(retry.status, 200);
    assert.equal(projects.get(ownerId, projectId).revision, 2);

    const rejected = await request({ ...baseBody, external_id: "followup:blocked", media_urls: ["https://example.com/private.jpg"] });
    assert.equal(rejected.status, 422);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
