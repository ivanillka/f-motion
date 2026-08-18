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
import { createTestApp } from "../dist/server.js";

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
    FENGINE_IMPORT_MEDIA_ORIGINS: "https://media.fotium.vip,https://fotium.vip",
    FENGINE_ENV: "hosted"
  });
  assert.deepEqual(configured.mediaOrigins, ["https://media.fotium.vip", "https://fotium.vip"]);
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
    mediaUrls: ["https://media.fotium.vip/galleries/look/1.jpg"]
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
  assert.equal(draft.source.callToAction, "Open the complete gallery.");
  assert.equal(draft.source.visualHint, "editorial portrait photography Prague");
  assert.deepEqual(parseExternalDraft({
    external_id: "queue:media",
    title: "Media",
    media_urls: ["https://media.fotium.vip/gallery/one.jpg"]
  }).mediaUrls, ["https://media.fotium.vip/gallery/one.jpg"]);
  const influencer = parseExternalDraft({
    externalId: "influencer:campaign-1",
    title: "Influencer reel",
    callToAction: "Shop the look.",
    visualHint: "golden hour portraits",
    architecture: { durationSeconds: 15 },
    mediaUrls: [
      "https://media.fotium.vip/galleries/a/1.jpg",
      { url: "https://media.fotium.vip/galleries/a/2.jpg" },
      { sourceUrl: "https://fotium.vip/cdn/a/3.jpg" }
    ]
  });
  assert.equal(influencer.externalId, "influencer:campaign-1");
  assert.equal(influencer.source.callToAction, "Shop the look.");
  assert.equal(influencer.architecture.media, "own");
  assert.deepEqual(influencer.mediaUrls, [
    "https://media.fotium.vip/galleries/a/1.jpg",
    "https://media.fotium.vip/galleries/a/2.jpg",
    "https://fotium.vip/cdn/a/3.jpg"
  ]);
  assert.deepEqual(parseExternalDraft({
    external_id: "queue:media",
    title: "Media",
    media_urls: ["http://localhost/a.jpg", "https://media.fotium.vip/galleries/look/1.jpg", "not-a-url"]
  }).mediaUrls, ["https://media.fotium.vip/galleries/look/1.jpg"]);
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
  const nine = Array.from({ length: 9 }, (_, index) => `https://media.fotium.vip/galleries/look/${index + 1}.jpg`);
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
        "https://media.fotium.vip/galleries/look/store.jpg"
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
      mediaOrigins: ["https://media.fotium.vip"]
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
      caption: "One final look. Open the gallery: https://fotium.vip/galleries/portrait"
    })).status, 201);
    const mediaBody = {
      ...baseBody,
      caption: "One final look. Open the gallery: https://fotium.vip/galleries/portrait",
      media_urls: [
        "https://media.fotium.vip/galleries/portrait/full/1.jpg",
        "https://media.fotium.vip/galleries/portrait/full/2.jpg"
      ]
    };
    const repaired = await request(mediaBody);
    assert.equal(repaired.status, 200);
    const projectId = (await repaired.json()).project_id;
    const project = projects.get(ownerId, projectId);
    assert.equal(project.revision, 2);
    assert.equal(project.scenes.length, 4);
    assert.ok(project.scenes.every((scene) => scene.media_id));
    assert.notEqual(project.scenes[0].media_id, project.scenes[1].media_id);
    assert.equal(project.scenes[0].media_id, project.scenes[2].media_id);
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
        "https://media.fotium.vip/galleries/look/missing.jpg",
        "https://media.fotium.vip/galleries/look/ok.jpg"
      ]
    });
    assert.equal(unreachable.status, 201);
    const partial = await unreachable.json();
    assert.match(partial.project_url, /\/app\/\?project=/);
    const partialProject = projects.get(ownerId, partial.project_id);
    assert.ok(partialProject.scenes.every((scene) => scene.media_id));
    assert.equal(new Set(partialProject.scenes.map((scene) => scene.media_id)).size, 2);

    const storeBroke = await request({
      ...baseBody,
      external_id: "followup:store",
      media_urls: ["https://media.fotium.vip/galleries/look/store.jpg"]
    });
    assert.equal(storeBroke.status, 201);
    assert.match((await storeBroke.json()).project_url, /\/app\/\?project=/);

    const bounced = await request({
      ...baseBody,
      external_id: "followup:bounce",
      media_urls: ["https://media.fotium.vip/galleries/look/bounce.jpg"]
    });
    assert.equal(bounced.status, 201);
    assert.match((await bounced.json()).project_url, /\/app\/\?project=/);

    const webp = await request({
      ...baseBody,
      external_id: "followup:webp",
      media_urls: ["https://media.fotium.vip/galleries/look/04.webp"]
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
      media_urls: ["https://media.fotium.vip/galleries/look/04.webp"]
    });
    assert.equal(webpRetry.status, 200);
    await waitFor(
      () => [...assets.values()].some((asset) => asset.projectId === webpProjectId && asset.state === "ready"),
      "quarantined webp sealed"
    );
    assert.equal(requested.length, webpBeforeRetry);
    assert.ok(stored.some((entry) => entry.fromKey && String(entry.key).includes("/media-sealed/")));

    const inspectUrl = "https://media.fotium.vip/galleries/look/inspect.jpg";
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
        { url: "https://media.fotium.vip/galleries/look/1.jpg" },
        { sourceUrl: "https://media.fotium.vip/galleries/look/2.jpg" }
      ]
    };
    assert.equal((await request(influencerBody)).status, 201);
    const firstInfluencer = projects.get(ownerId, projectIdForExternalImport(ownerId, "influencer:lookbook-1"));
    assert.equal(firstInfluencer.scenes[0].media_id, projectIdForExternalImport(
      projectIdForExternalImport(ownerId, "influencer:lookbook-1"),
      "https://media.fotium.vip/galleries/look/1.jpg"
    ));
    const swapped = await request({
      ...influencerBody,
      mediaUrls: [
        "https://media.fotium.vip/galleries/look/3.jpg",
        "https://media.fotium.vip/galleries/look/4.jpg"
      ]
    });
    assert.equal(swapped.status, 200);
    const updated = projects.get(ownerId, projectIdForExternalImport(ownerId, "influencer:lookbook-1"));
    assert.ok(updated.revision > firstInfluencer.revision);
    assert.equal(updated.scenes[0].media_id, projectIdForExternalImport(
      projectIdForExternalImport(ownerId, "influencer:lookbook-1"),
      "https://media.fotium.vip/galleries/look/3.jpg"
    ));
    assert.equal(updated.scenes[1].media_id, projectIdForExternalImport(
      projectIdForExternalImport(ownerId, "influencer:lookbook-1"),
      "https://media.fotium.vip/galleries/look/4.jpg"
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
      mediaOrigins: ["https://media.fotium.vip"]
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
        media_urls: ["https://media.fotium.vip/galleries/look/slow.jpg"]
      })
    });
    assert.equal(response.status, 201);
    assert.ok(Date.now() - started < 250);
    const body = await response.json();
    assert.match(body.project_url, /\/app\/\?project=/);
    const project = projects.get(ownerId, body.project_id);
    assert.ok(project.scenes.every((scene) => scene.media_id));
    assert.ok([...assets.values()].every((asset) => asset.state === "admitted"));
  } finally {
    release();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
