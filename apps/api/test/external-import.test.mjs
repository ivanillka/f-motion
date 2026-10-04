import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import {
  externalImportConfigFromEnv,
  isExternalId,
  parseExternalDraft,
  projectIdForExternalImport
} from "../dist/external-import.js";
import { RenderInputIncompleteError } from "../dist/render-repository.js";
import { createTestApp } from "../dist/server.js";
import { SPOKEN_VOICE } from "@f-engine/reel-engine";
import { encodeWav, synthesizeSpeech, wavPcm } from "../dist/speech-wav.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function waitFor(predicate, label = "condition") {
  const deadline = Date.now() + 2_000;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
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
    FENGINE_IMPORT_MEDIA_ORIGINS: "https://media.example.com,https://host.example.com",
    FENGINE_ENV: "hosted"
  });
  assert.deepEqual(configured.mediaOrigins, ["https://media.example.com", "https://host.example.com"]);
});

test("influencer campaign filenames are valid external ids", () => {
  const campaign = "dope.veg × mallghareth_if — February 2020 — August 2026 — Campaign.md";
  assert.equal(isExternalId(campaign), true);
  assert.equal(isExternalId(`influencer:${campaign}`), true);
  assert.equal(isExternalId("queue:abc123"), true);
  assert.equal(isExternalId("bad/id"), false);
  assert.equal(isExternalId("bad\\id"), false);
  assert.equal(isExternalId(""), false);
  assert.equal(parseExternalDraft({ external_id: "bad/id", title: "Title" }).externalId, "bad-id");
  const draft = parseExternalDraft({
    externalId: `influencer:${campaign}`,
    title: "Dope × Mallghareth",
    mediaUrls: ["https://media.example.com/galleries/look/1.jpg"]
  });
  assert.equal(draft.externalId, `influencer:${campaign}`);
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
  assert.equal(draft.brief.frame, "reel");
  assert.equal(parseExternalDraft({
    external_id: "queue:youtube",
    title: "YouTube launch",
    architecture: { delivery: "youtube" }
  }).architecture.delivery, "youtube");
  assert.equal(draft.source.callToAction, "Open the complete gallery.");
  assert.equal(draft.source.visualHint, "editorial portrait photography Prague");
  assert.deepEqual(parseExternalDraft({
    external_id: "queue:media",
    title: "Media",
    media_urls: ["https://media.example.com/gallery/one.jpg"]
  }).mediaUrls, ["https://media.example.com/gallery/one.jpg"]);
  const influencer = parseExternalDraft({
    externalId: "influencer:campaign-1",
    title: "Influencer reel",
    callToAction: "Shop the look.",
    visualHint: "golden hour portraits",
    architecture: { durationSeconds: 15 },
    mediaUrls: [
      "https://media.example.com/galleries/a/1.jpg",
      { url: "https://media.example.com/galleries/a/2.jpg" },
      { sourceUrl: "https://host.example.com/cdn/a/3.jpg" }
    ]
  });
  assert.equal(influencer.externalId, "influencer:campaign-1");
  assert.equal(influencer.source.callToAction, "Shop the look.");
  assert.equal(influencer.architecture.media, "own");
  assert.deepEqual(influencer.mediaUrls, [
    "https://media.example.com/galleries/a/1.jpg",
    "https://media.example.com/galleries/a/2.jpg",
    "https://host.example.com/cdn/a/3.jpg"
  ]);
  assert.deepEqual(parseExternalDraft({
    external_id: "queue:media",
    title: "Media",
    media_urls: ["http://localhost/a.jpg", "https://media.example.com/galleries/look/1.jpg", "not-a-url"]
  }).mediaUrls, ["https://media.example.com/galleries/look/1.jpg"]);
  assert.equal(parseExternalDraft({
    external_id: "queue:duration",
    title: "Duration",
    architecture: { duration_seconds: "15", goal: "launch" }
  }).architecture.durationSeconds, 15);
  assert.equal(parseExternalDraft({
    external_id: "queue:snap",
    title: "Snap",
    architecture: { durationSeconds: 20 }
  }).architecture.durationSeconds, 15);
  assert.equal(parseExternalDraft({ title: "No id" }).externalId.startsWith("imported:"), true);
  assert.ok(parseExternalDraft(null).brief.purpose);
  const nine = Array.from({ length: 9 }, (_, index) => `https://media.example.com/galleries/look/${index + 1}.jpg`);
  assert.deepEqual(parseExternalDraft({
    external_id: "queue:nine",
    title: "Nine stills",
    media_urls: nine
  }).mediaUrls, nine.slice(0, 8));
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
    assert.equal(created.project_url, `https://f-motion.example/app/?project=${created.project_id}`);
    assert.equal(created.projectUrl, created.project_url);
    const project = projects.get(ownerId, created.project_id);
    assert.equal(project.scenes.length, 4);
    assert.match(project.scenes[0].visual_prompt, /editorial portrait photography/i);
    assert.equal(project.scenes[0].caption, "A portrait series returns for one final look.");
    assert.equal(project.scenes.at(-1).caption, "See Gallery follow-up.");
    assert.doesNotMatch(project.scenes.map(({ caption }) => caption).join("\n"), /open the full gallery|the story begins/i);

    const second = await request();
    assert.equal(second.status, 200);
    assert.equal((await second.json()).project_id, created.project_id);
    assert.equal(projects.list(ownerId).length, 1);

    const messy = await fetch(`${origin}/api/integrations/project-imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        external_id: "task/41654960-337a-4288-96c1-96a0e7c2ddb8",
        architecture: { duration_seconds: 20, goal: "launch" },
        media_urls: ["http://localhost/a.jpg", "https://example.com/private.jpg"]
      })
    });
    assert.equal(messy.status, 201);
    const messyBody = await messy.json();
    assert.match(messyBody.projectUrl, /\/app\/\?project=/);
    assert.equal(messyBody.project_id, projectIdForExternalImport(ownerId, "task-41654960-337a-4288-96c1-96a0e7c2ddb8"));
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
    async markImportedStillReady(owner, project, id, sealed, detected) {
      const asset = assets.get(id);
      if (!asset || asset.ownerId !== owner || asset.projectId !== project) return undefined;
      if (asset.state !== "admitted" && asset.state !== "inspecting" && asset.state !== "quarantined") return undefined;
      const ready = {
        ...asset,
        state: "ready",
        sealedObjectKey: sealed.objectKey,
        sealedEtag: sealed.etag,
        sealedSha256: sealed.sha256,
        detected
      };
      assets.set(id, ready);
      return ready;
    },
    async completeAdmission(owner, project, id) {
      const asset = assets.get(id);
      if (!asset || asset.ownerId !== owner || asset.projectId !== project) return false;
      assets.set(id, { ...asset, state: "inspecting" });
      return true;
    }
  };
  const stored = [];
  const knownObjects = new Set();
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0
  ]);
  const store = {
    async put(key, body, type, bytes) {
      if (key.includes(projectIdForExternalImport(
        projectIdForExternalImport(ownerId, "followup:store"),
        "https://media.example.com/galleries/look/store.jpg"
      ))) {
        throw new Error("R2 unavailable");
      }
      let total = 0;
      if (body instanceof Uint8Array) {
        total = body.byteLength;
      } else {
        for await (const chunk of body) total += chunk.byteLength;
      }
      assert.equal(total, bytes);
      stored.push({ key, type, bytes });
      knownObjects.add(key);
      return { etag: "etag" };
    },
    async exists(key) {
      return knownObjects.has(key);
    },
    async read() {
      throw new Error("unexpected read");
    },
    async readPrefix() {
      return pngHeader;
    },
    async copy(fromKey, toKey) {
      stored.push({ key: toKey, type: "copy", bytes: 0, fromKey });
      knownObjects.add(toKey);
      return { etag: "etag" };
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
      mediaOrigins: ["https://media.example.com"]
    },
    externalMediaRequest: async (input, init) => {
      requested.push({ input: String(input), redirect: init?.redirect });
      if (String(input).includes("missing.jpg")) {
        return new Response("forbidden", { status: 403, headers: { "content-type": "text/html" } });
      }
      if (String(input).includes("bounce.jpg")) {
        const bounced = new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
          headers: { "content-type": "image/jpeg", "content-length": "3" }
        });
        Object.defineProperty(bounced, "url", { value: "https://evil.example/stolen.jpg" });
        return bounced;
      }
      const type = String(input).endsWith(".webp") ? "image/webp" : "image/png";
      const body = type === "image/webp"
        ? new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
          0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0
        ])
        : new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0
        ]);
      return new Response(body, {
        headers: { "content-type": type, "content-length": String(body.byteLength) }
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
      caption: "One final look. Open the gallery: https://host.example.com/galleries/portrait"
    })).status, 201);
    const mediaBody = {
      ...baseBody,
      caption: "One final look. Open the gallery: https://host.example.com/galleries/portrait",
      media_urls: [
        "https://media.example.com/galleries/portrait/full/1.jpg",
        "https://media.example.com/galleries/portrait/full/2.jpg"
      ]
    };
    const repaired = await request(mediaBody);
    assert.equal(repaired.status, 200);
    const projectId = (await repaired.json()).project_id;
    const project = projects.get(ownerId, projectId);
    assert.equal(project.revision, 2);
    assert.equal(project.scenes.length, 4);
    assert.ok(project.scenes.slice(0, 2).every((scene) => scene.media_id));
    assert.ok(project.scenes.slice(2).every((scene) => !scene.media_id));
    assert.notEqual(project.scenes[0].media_id, project.scenes[1].media_id);
    assert.match(project.scenes.map(({ caption }) => caption).join(" "), /One final look/);
    assert.doesNotMatch(project.scenes.map(({ caption }) => caption).join(" "), /https:\/\//);
    await waitFor(() => stored.length === 4 && [...assets.values()].every((asset) => asset.state === "ready"), "gallery stills ready");
    assert.deepEqual(requested.map(({ redirect }) => redirect), ["follow", "follow"]);
    assert.ok([...assets.values()].every((asset) => asset.detected?.width === 2));

    const retry = await request({ ...mediaBody, caption: baseBody.caption });
    assert.equal(retry.status, 200);
    const cleaned = projects.get(ownerId, projectId);
    assert.equal(cleaned.revision, 3);
    assert.doesNotMatch(cleaned.scenes.map(({ caption }) => caption).join(" "), /https:\/\//);
    assert.deepEqual(cleaned.scenes.map(({ visual_prompt }) => visual_prompt), [
      "Selected gallery image 1",
      "Selected gallery image 2",
      "Selected gallery image 3",
      "Selected gallery image 4"
    ]);
    assert.equal(stored.length, 4);

    const rejected = await request({ ...baseBody, external_id: "followup:blocked", media_urls: ["https://example.com/private.jpg"] });
    assert.equal(rejected.status, 201);
    const blocked = await rejected.json();
    assert.match(blocked.project_url, /\/app\/\?project=/);
    assert.ok(projects.get(ownerId, blocked.project_id).scenes.every((scene) => !scene.media_id));

    const unreachable = await request({
      ...baseBody,
      external_id: "followup:403",
      media_urls: [
        "https://media.example.com/galleries/look/missing.jpg",
        "https://media.example.com/galleries/look/ok.jpg"
      ]
    });
    assert.equal(unreachable.status, 201);
    const partial = await unreachable.json();
    assert.match(partial.project_url, /\/app\/\?project=/);
    const partialProject = projects.get(ownerId, partial.project_id);
    assert.equal(partialProject.scenes.filter((scene) => scene.media_id).length, 2);
    assert.equal(new Set(partialProject.scenes.map((scene) => scene.media_id).filter(Boolean)).size, 2);
    assert.ok(partialProject.scenes.slice(2).every((scene) => !scene.media_id));

    const storeBroke = await request({
      ...baseBody,
      external_id: "followup:store",
      media_urls: ["https://media.example.com/galleries/look/store.jpg"]
    });
    assert.equal(storeBroke.status, 201);
    assert.match((await storeBroke.json()).project_url, /\/app\/\?project=/);

    const bounced = await request({
      ...baseBody,
      external_id: "followup:bounce",
      media_urls: ["https://media.example.com/galleries/look/bounce.jpg"]
    });
    assert.equal(bounced.status, 201);
    assert.match((await bounced.json()).project_url, /\/app\/\?project=/);

    const webp = await request({
      ...baseBody,
      external_id: "followup:webp",
      media_urls: ["https://media.example.com/galleries/look/04.webp"]
    });
    assert.equal(webp.status, 201);
    const webpProjectId = projectIdForExternalImport(ownerId, "followup:webp");
    await waitFor(
      () => [...assets.values()].some((asset) => asset.projectId === webpProjectId && asset.state === "ready"),
      "webp ready"
    );
    const webpBeforeRetry = requested.length;
    for (const [id, asset] of assets) {
      if (asset.projectId === webpProjectId) assets.set(id, { ...asset, state: "quarantined" });
    }
    const webpRetry = await request({
      ...baseBody,
      external_id: "followup:webp",
      media_urls: ["https://media.example.com/galleries/look/04.webp"]
    });
    assert.equal(webpRetry.status, 200);
    await waitFor(
      () => [...assets.values()].some((asset) => asset.projectId === webpProjectId && asset.state === "ready"),
      "quarantined webp sealed"
    );
    assert.equal(requested.length, webpBeforeRetry);
    assert.ok(stored.some((entry) => entry.fromKey && String(entry.key).includes("/media-sealed/")));

    const inspectUrl = "https://media.example.com/galleries/look/inspect.jpg";
    const inspectExternalId = "followup:inspecting";
    const inspectProjectId = projectIdForExternalImport(ownerId, inspectExternalId);
    const inspectMediaId = projectIdForExternalImport(inspectProjectId, inspectUrl);
    assets.set(inspectMediaId, {
      id: inspectMediaId,
      ownerId,
      projectId: inspectProjectId,
      quarantineObjectKey: `projects/${inspectProjectId}/media-quarantine/${inspectMediaId}`,
      state: "inspecting",
      declaredType: "image/png",
      maxBytes: 1024
    });
    knownObjects.add(`projects/${inspectProjectId}/media-quarantine/${inspectMediaId}`);
    const requestedBeforeInspect = requested.length;
    const inspectRes = await request({
      ...baseBody,
      external_id: inspectExternalId,
      media_urls: [inspectUrl]
    });
    assert.equal(inspectRes.status, 201);
    await waitFor(() => assets.get(inspectMediaId)?.state === "ready", "inspecting still sealed");
    assert.equal(requested.length, requestedBeforeInspect);
    assert.ok(stored.some((entry) =>
      entry.fromKey === `projects/${inspectProjectId}/media-quarantine/${inspectMediaId}`
      && entry.key === `projects/${inspectProjectId}/media-sealed/${inspectMediaId}`
    ));

    // Queue Edit again with a new media pick must replace scene attachments.
    const influencerBody = {
      externalId: "influencer:lookbook-1",
      title: "Lookbook",
      callToAction: "See the set.",
      mediaUrls: [
        { url: "https://media.example.com/galleries/look/1.jpg" },
        { sourceUrl: "https://media.example.com/galleries/look/2.jpg" }
      ]
    };
    assert.equal((await request(influencerBody)).status, 201);
    const firstInfluencer = projects.get(ownerId, projectIdForExternalImport(ownerId, "influencer:lookbook-1"));
    assert.equal(firstInfluencer.scenes[0].media_id, projectIdForExternalImport(
      projectIdForExternalImport(ownerId, "influencer:lookbook-1"),
      "https://media.example.com/galleries/look/1.jpg"
    ));
    const swapped = await request({
      ...influencerBody,
      mediaUrls: [
        "https://media.example.com/galleries/look/3.jpg",
        "https://media.example.com/galleries/look/4.jpg"
      ]
    });
    assert.equal(swapped.status, 200);
    const updated = projects.get(ownerId, projectIdForExternalImport(ownerId, "influencer:lookbook-1"));
    assert.ok(updated.revision > firstInfluencer.revision);
    assert.equal(updated.scenes[0].media_id, projectIdForExternalImport(
      projectIdForExternalImport(ownerId, "influencer:lookbook-1"),
      "https://media.example.com/galleries/look/3.jpg"
    ));
    assert.equal(updated.scenes[1].media_id, projectIdForExternalImport(
      projectIdForExternalImport(ownerId, "influencer:lookbook-1"),
      "https://media.example.com/galleries/look/4.jpg"
    ));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("trusted import returns the draft URL before host stills finish copying", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const token = "trusted-import-token-that-is-long-enough";
  const projects = new ProjectService();
  const assets = new Map();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const server = createServer(createTestApp({
    projects,
    media: {
      repository: {
        async get(owner, project, id) {
          const asset = assets.get(id);
          return asset?.ownerId === owner && asset?.projectId === project ? structuredClone(asset) : undefined;
        },
        async insert(asset) { assets.set(asset.id, structuredClone(asset)); }
      },
      store: {
        async exists() { return false; },
        async put() { throw new Error("copy must not block the reply"); }
      }
    },
    externalImports: {
      token,
      ownerId,
      webOrigin: "https://f-motion.example",
      mediaOrigins: ["https://media.example.com"]
    },
    externalMediaRequest: async () => {
      await gate;
      return new Response("too late", { status: 599 });
    }
  }));
  const origin = await listen(server);
  try {
    const started = Date.now();
    const response = await fetch(`${origin}/api/integrations/project-imports`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        external_id: "followup:slow-stills",
        title: "Slow stills",
        media_urls: ["https://media.example.com/galleries/look/slow.jpg"]
      })
    });
    assert.equal(response.status, 201);
    assert.ok(Date.now() - started < 250);
    const body = await response.json();
    assert.match(body.project_url, /\/app\/\?project=/);
    const project = projects.get(ownerId, body.project_id);
    assert.equal(project.scenes.filter((scene) => scene.media_id).length, 1);
    assert.ok(project.scenes[0]?.media_id);
    assert.ok(project.scenes.slice(1).every((scene) => !scene.media_id));
    assert.ok([...assets.values()].every((asset) => asset.state === "admitted"));
  } finally {
    release();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("trusted import stores notify_url and rejects origins outside the allowlist", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const token = "trusted-import-token-that-is-long-enough";
  const projects = new ProjectService();
  const server = createServer(createTestApp({
    projects,
    externalImports: { token, ownerId, webOrigin: "https://f-motion.example", mediaOrigins: [] },
    renderNotify: { secret: "y".repeat(32), origins: ["https://cms.example.com"] }
  }));
  const origin = await listen(server);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    assert.equal(parseExternalDraft({
      external_id: "cms:gallery:weekend",
      notify_url: "https://cms.example.com/hooks/fmotion"
    }).notifyUrl, "https://cms.example.com/hooks/fmotion");
    const rejected = await fetch(`${origin}/api/integrations/project-imports`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        external_id: "cms:gallery:blocked",
        title: "Blocked",
        notify_url: "https://evil.example/steal"
      })
    });
    assert.equal(rejected.status, 422);
    const accepted = await fetch(`${origin}/api/integrations/project-imports`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        external_id: "cms:gallery:weekend",
        title: "Weekend portraits",
        notify_url: "https://cms.example.com/hooks/fmotion"
      })
    });
    assert.equal(accepted.status, 201);
    const created = await accepted.json();
    assert.equal(created.projectUrl, created.project_url);
    const binding = projects.hostImportBinding(ownerId, created.project_id);
    assert.equal(binding.externalId, "cms:gallery:weekend");
    assert.equal(binding.notifyUrl, "https://cms.example.com/hooks/fmotion");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("render enqueue validates notify_url and forwards it with the host external id", async () => {
  const admitted = [];
  const server = createServer(createTestApp({
    renderNotify: { secret: "y".repeat(32), origins: ["https://cms.example.com"] },
    renders: {
      async create(ownerId, projectId, kind, options) {
        admitted.push({ ownerId, projectId, kind, options });
        return { jobId: "job", ownerId, projectId, revision: 0, kind, renderProfile: { width: 540, height: 960 }, state: "queued" };
      }
    }
  }));
  const origin = await listen(server);
  try {
    const { project } = await (await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Preview" })
    })).json();
    const blocked = await fetch(`${origin}/api/projects/${project.id}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "preview", notify_url: "https://evil.example/steal" })
    });
    assert.equal(blocked.status, 422);
    const extra = await fetch(`${origin}/api/projects/${project.id}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "preview", width: 999 })
    });
    assert.equal(extra.status, 422);
    const accepted = await fetch(`${origin}/api/projects/${project.id}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "preview",
        notify_url: "https://cms.example.com/hooks/fmotion",
        external_id: "cms:gallery:weekend"
      })
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(admitted.at(-1).options, {
      notifyUrl: "https://cms.example.com/hooks/fmotion",
      externalId: "cms:gallery:weekend"
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("the same external id reopens one draft and the host can play and download its 9:16 preview", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const token = "trusted-import-token-that-is-long-enough";
  const externalId = "fotium:post:42";
  const existingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const projects = new ProjectService();
  projects.create(ownerId, {
    purpose: "Kept draft",
    audience: "Social audience",
    tone: "cinematic, balanced",
    frame: "reel"
  }, existingId);
  projects.bindHostImport(ownerId, existingId, { externalId });
  let billed = 0;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = createServer(createTestApp({
    projects,
    hostUsage: {
      async status() {
        return { unit: "render_unit", balance: 0, free_grant: 0, costs: { preview: 1, final: 2 } };
      },
      async consumeRender() {
        billed += 1;
        return 0;
      },
      async ensureFreeGrant() {}
    },
    renders: {
      async create(_owner, projectId, kind) {
        assert.equal(projectId, existingId);
        assert.equal(kind, "preview");
        const project = projects.get(ownerId, projectId);
        return {
          jobId: "job-portrait",
          ownerId,
          projectId,
          revision: project.revision,
          kind,
          renderProfile: { width: 540, height: 960 },
          state: "complete"
        };
      },
      async latestPortraitPreview(_owner, projectId) {
        const project = projects.get(ownerId, projectId);
        return {
          jobId: "job-portrait",
          objectKey: "projects/preview.mp4",
          width: 540,
          height: 960,
          revision: project.revision
        };
      }
    },
    media: {
      repository: {},
      store: { async signedGet(key) { return `https://signed.example/${key}`; } }
    },
    externalImports: { token, ownerId, webOrigin: "https://f-motion.example", mediaOrigins: [] }
  }));
  const origin = await listen(server);
  try {
    assert.equal((await fetch(`${origin}/v1/integrations/project-imports?external_id=missing:post`, {
      headers: { authorization: `Bearer ${token}` }
    })).status, 404);
    assert.equal(projects.list(ownerId).length, 1);

    const opened = await fetch(`${origin}/v1/integrations/project-imports`, {
      method: "POST",
      headers,
      body: JSON.stringify({ external_id: externalId, title: "Post 42" })
    });
    assert.equal(opened.status, 200);
    const draft = await opened.json();
    assert.equal(draft.created, false);
    assert.equal(draft.project_id, existingId);
    assert.equal(draft.projectUrl, `https://f-motion.example/app/?project=${existingId}`);
    assert.equal(projects.list(ownerId).length, 1);
    assert.equal(projects.get(ownerId, existingId).brief.frame, "reel");

    const preview = await fetch(`${origin}/v1/integrations/project-imports/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ external_id: externalId })
    });
    assert.equal(preview.status, 200);
    const file = await preview.json();
    assert.equal(file.project_id, existingId);
    assert.equal(file.preview.play_url, "https://signed.example/projects/preview.mp4");
    assert.equal(file.preview.download_url, file.preview.play_url);
    assert.equal(file.preview.width, 540);
    assert.equal(file.preview.height, 960);
    assert.ok(file.preview.height > file.preview.width);
    assert.equal(billed, 0);
    assert.equal(projects.list(ownerId).length, 1);

    const again = await fetch(
      `${origin}/api/integrations/project-imports?external_id=${encodeURIComponent(externalId)}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    assert.equal(again.status, 200);
    assert.equal((await again.json()).project_id, existingId);
    assert.equal((await fetch(`${origin}/v1/integrations/project-imports/preview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ external_id: "missing:post" })
    })).status, 404);
    assert.equal(projects.list(ownerId).length, 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function playbackScene(id, caption, extra = {}) {
  return {
    id,
    order: 0,
    caption,
    visual_prompt: "A painted figure",
    duration_ms: 3000,
    focal_x: 0.4,
    focal_y: 0.6,
    motion: "zoom",
    audio_level: 1,
    ducking: false,
    overlay_look: "caption",
    overlay_place: "bottom",
    ...extra
  };
}

function playbackMediaStore() {
  const assets = new Map();
  return {
    assets,
    add(id, type = "image/jpeg") {
      assets.set(id, {
        id,
        state: "ready",
        sealedObjectKey: `projects/media/${id}`,
        declaredType: type,
        ownerId: "owner",
        projectId: "project",
        quarantineObjectKey: "q",
        maxBytes: 10,
        detected: { type, bytes: 10, width: 1080, height: 1920 }
      });
    },
    repository: {
      async get(_owner, _project, id) {
        return assets.get(id);
      }
    },
    store: {
      async signedGet(key) {
        return `https://signed.example/${key}`;
      }
    }
  };
}

function countingSpeech(assets) {
  const files = new Map();
  let puts = 0;
  return {
    puts: () => puts,
    files,
    async putWav(_owner, _project, bytes) {
      puts += 1;
      const id = `wav-${puts}`;
      files.set(id, bytes);
      assets.set(id, {
        id,
        state: "ready",
        sealedObjectKey: `projects/media/${id}`,
        declaredType: "audio/wav",
        ownerId: "owner",
        projectId: "project",
        quarantineObjectKey: "q",
        maxBytes: bytes.byteLength,
        detected: { type: "audio/wav", bytes: bytes.byteLength }
      });
      return id;
    },
    async readWav(_owner, _project, id) {
      return files.get(id);
    }
  };
}

test("partner preview plays scene media without a voiceover and keeps the MP4 fields", async () => {
  const token = "p".repeat(32);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const externalId = "cms:gallery:silent";
  const projects = new ProjectService();
  const created = projects.create(ownerId, {
    purpose: "Quiet frames",
    audience: "Viewers",
    tone: "Calm"
  });
  projects.bindHostImport(ownerId, created.id, { externalId });
  projects.command(ownerId, {
    command_id: "board",
    project_id: created.id,
    base_revision: created.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: {
      scenes: [
        playbackScene("s1", "Quiet frames from the day.", { media_id: "still-1", duration_ms: 3000, order: 0 }),
        playbackScene("s2", "Hold on the last frame.", { media_id: "still-2", duration_ms: 4000, order: 1 })
      ]
    }
  });
  const waitingId = "cms:gallery:waiting";
  const waiting = projects.create(ownerId, {
    purpose: "Waiting on a file",
    audience: "Viewers",
    tone: "Calm"
  });
  projects.bindHostImport(ownerId, waiting.id, { externalId: waitingId });
  projects.command(ownerId, {
    command_id: "board-waiting",
    project_id: waiting.id,
    base_revision: waiting.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: {
      scenes: [playbackScene("w1", "Still waiting.", { media_id: "still-1" })]
    }
  });
  const media = playbackMediaStore();
  media.add("still-1");
  media.add("still-2", "video/mp4");
  const speech = countingSpeech(media.assets);
  let billed = 0;
  let renders = 0;
  const server = createServer(createTestApp({
    projects,
    spokenAudio: speech,
    hostUsage: {
      async status() {
        return { unit: "render_unit", balance: 0, free_grant: 0, costs: { preview: 1, final: 2 } };
      },
      async consumeRender() {
        billed += 1;
        return 0;
      },
      async ensureFreeGrant() {}
    },
    renders: {
      async create() {
        renders += 1;
        return {
          jobId: "job-queued",
          state: "queued",
          renderProfile: { width: 540, height: 960 }
        };
      },
      async latestPortraitPreview(_owner, projectId) {
        const project = projects.get(ownerId, projectId);
        if (project.brief.purpose === "Waiting on a file") return undefined;
        return {
          jobId: "job-portrait",
          objectKey: "projects/preview.mp4",
          width: 540,
          height: 960,
          revision: project.revision
        };
      }
    },
    media: { repository: media.repository, store: media.store },
    externalImports: { token, ownerId, webOrigin: "https://f-motion.example", mediaOrigins: [] }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/v1/integrations/project-imports/preview`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ external_id: externalId })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.preview.play_url, "https://signed.example/projects/preview.mp4");
    assert.equal(body.preview.download_url, body.preview.play_url);
    assert.equal(body.preview.width, 540);
    assert.equal(body.preview.height, 960);
    assert.equal(body.playback.voiceover, null);
    assert.equal(body.playback.total_ms, 7000);
    assert.equal(body.playback.scenes.length, 2);
    assert.equal(body.playback.scenes[0].media.url, "https://signed.example/projects/media/still-1");
    assert.equal(body.playback.scenes[0].media.type, "image/jpeg");
    assert.equal(body.playback.scenes[0].media.muted, true);
    assert.equal(body.playback.scenes[0].words[0].text, "Quiet");
    assert.equal(body.playback.scenes[0].start_ms, 0);
    assert.equal(body.playback.scenes[1].media.url, "https://signed.example/projects/media/still-2");
    assert.equal(body.playback.scenes[1].media.type, "video/mp4");
    assert.equal(body.playback.scenes[1].start_ms, 3000);
    assert.equal(speech.puts(), 0);
    assert.equal(billed, 0);
    assert.equal(renders, 1);

    const waitingResponse = await fetch(`${origin}/v1/integrations/project-imports/preview`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ external_id: waitingId })
    });
    assert.equal(waitingResponse.status, 202);
    const waitingBody = await waitingResponse.json();
    assert.equal(waitingBody.preview, null);
    assert.equal(waitingBody.job_id, "job-queued");
    assert.equal(waitingBody.playback.voiceover, null);
    assert.equal(waitingBody.playback.scenes[0].media.url, "https://signed.example/projects/media/still-1");
    assert.equal(waitingBody.playback.scenes[0].media.muted, true);
    assert.equal(billed, 0);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("partner preview speaks Spoken lines once and leaves a user voice-over in place", async () => {
  const token = "v".repeat(32);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const spokenId = "cms:gallery:spoken";
  const ownedId = "cms:gallery:owned";
  const projects = new ProjectService();
  const media = playbackMediaStore();
  media.add("still-1");
  media.add("user-take", "audio/wav");
  const speech = countingSpeech(media.assets);

  function bind(externalId, purpose) {
    const created = projects.create(ownerId, { purpose, audience: "Viewers", tone: "Calm" });
    projects.bindHostImport(ownerId, created.id, { externalId });
    return projects.command(ownerId, {
      command_id: `board-${externalId}`,
      project_id: created.id,
      base_revision: created.revision,
      client_timestamp: "t",
      kind: "replace_storyboard",
      payload: {
        scenes: [
          playbackScene("s1", "Selected gallery image 4", {
            media_id: "still-1",
            overlay_look: "caption",
            duration_ms: 3000,
            order: 0
          }),
          playbackScene("s2", "Read the full post.", {
            overlay_look: "spoken",
            overlay_place: "center",
            order: 1,
            duration_ms: 4000
          })
        ]
      }
    });
  }

  bind(spokenId, "The night already had a script");
  const owned = bind(ownedId, "A voice the user kept");
  projects.command(ownerId, {
    command_id: "user-voice",
    project_id: owned.id,
    base_revision: owned.revision,
    client_timestamp: "t",
    kind: "update_voiceover",
    payload: { voiceover: { media_id: "user-take", offset_ms: 120, level: 0.8 } }
  });

  let billed = 0;
  const spokenCalls = [];
  const spokenSynthesizer = async (request) => {
    spokenCalls.push(request);
    const samples = new Int16Array(2_400);
    samples.fill(9_000);
    return encodeWav(samples, 24_000);
  };
  const server = createServer(createTestApp({
    projects,
    spokenAudio: speech,
    spokenSynthesizer,
    hostUsage: {
      async status() {
        return { unit: "render_unit", balance: 0, free_grant: 0, costs: { preview: 1, final: 2 } };
      },
      async consumeRender() {
        billed += 1;
        return 0;
      },
      async ensureFreeGrant() {}
    },
    media: { repository: media.repository, store: media.store },
    externalImports: { token, ownerId, webOrigin: "https://f-motion.example", mediaOrigins: [] }
  }));
  const origin = await listen(server);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const preview = (externalId) => fetch(`${origin}/v1/integrations/project-imports/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify({ external_id: externalId })
  });
  try {
    const ownedResponse = await preview(ownedId);
    assert.equal(ownedResponse.status, 200);
    const ownedBody = await ownedResponse.json();
    assert.equal(ownedBody.job_id, undefined);
    assert.equal(ownedBody.preview, null);
    assert.equal(ownedBody.playback.voiceover.url, "https://signed.example/projects/media/user-take");
    assert.equal(ownedBody.playback.voiceover.offset_ms, 120);
    assert.equal(ownedBody.playback.voiceover.level, 0.8);
    assert.equal(speech.puts(), 0);
    assert.equal(projects.findByExternalId(ownerId, ownedId).brief.voiceover.media_id, "user-take");

    const firstResponse = await preview(spokenId);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.job_id, undefined);
    assert.ok(first.playback.voiceover.url.startsWith("https://signed.example/projects/media/wav-"));
    assert.equal(first.playback.voiceover.offset_ms, 0);
    assert.equal(first.playback.voiceover.level, 1);
    assert.equal(first.playback.scenes[1].overlay_look, "spoken");
    assert.equal(first.playback.scenes[1].words[0].text, "Read");
    assert.equal(first.playback.scenes[0].media.muted, true);
    assert.deepEqual(spokenCalls.map((call) => call.text), ["Read the full post."]);
    assert.ok(spokenCalls.every((call) => call.voice === SPOKEN_VOICE.voice
      && call.speed === SPOKEN_VOICE.speed
      && call.endpoint === SPOKEN_VOICE.endpoint));
    const played = speech.files.get(projects.findByExternalId(ownerId, spokenId).brief.voiceover.media_id);
    assert.notEqual(wavPcm(played).sampleRate, wavPcm(synthesizeSpeech("Read the full post.")).sampleRate);
    assert.ok(speech.puts() > 0);
    const puts = speech.puts();
    const voiceUrl = first.playback.voiceover.url;

    const secondResponse = await preview(spokenId);
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(speech.puts(), puts);
    assert.equal(spokenCalls.length, 1);
    assert.equal(second.playback.voiceover.url, voiceUrl);
    assert.equal(second.revision, first.revision);

    const refreshed = await fetch(
      `${origin}/v1/integrations/project-imports?external_id=${encodeURIComponent(spokenId)}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.json()).playback.voiceover.url, voiceUrl);
    assert.equal(speech.puts(), puts);
    assert.equal(billed, 0);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("partner playback is returned when a render cannot start", async () => {
  const token = "r".repeat(32);
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const externalId = "cms:gallery:incomplete";
  const projects = new ProjectService();
  const created = projects.create(ownerId, { purpose: "Quiet frames", audience: "Viewers", tone: "Calm" });
  projects.bindHostImport(ownerId, created.id, { externalId });
  projects.command(ownerId, {
    command_id: "board",
    project_id: created.id,
    base_revision: created.revision,
    client_timestamp: "t",
    kind: "replace_storyboard",
    payload: { scenes: [playbackScene("s1", "Quiet frames from the day.", { media_id: "still-1" })] }
  });
  const media = playbackMediaStore();
  media.add("still-1");
  const server = createServer(createTestApp({
    projects,
    renders: {
      async create() {
        throw new RenderInputIncompleteError("Every scene needs ready media before rendering.");
      }
    },
    media: { repository: media.repository, store: media.store },
    externalImports: { token, ownerId, webOrigin: "https://f-motion.example", mediaOrigins: [] }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/v1/integrations/project-imports/preview`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ external_id: externalId })
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.type, "render_input_incomplete");
    assert.equal(body.playback.voiceover, null);
    assert.equal(body.playback.scenes[0].media.url, "https://signed.example/projects/media/still-1");
    assert.equal(body.playback.scenes[0].media.muted, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

