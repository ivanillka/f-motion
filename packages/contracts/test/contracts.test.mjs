import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { acceptsFixture, isProjectSnapshot, isSoundtrack, isVoiceover, isStoryboardScenes, isStoryboardPlan, isSceneBrief } from "../dist/index.js";
import { parseNotifyUrl, renderNotifyConfigFromEnv, signRenderNotify, verifyRenderNotify, deliverRenderNotify, buildRenderCompleteNotify } from "../dist/host-notify.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url)));
const inventory = JSON.parse(await readFile(new URL("../route-inventory.json", import.meta.url), "utf8"));
const openapi = await readFile(new URL("../openapi.yaml", import.meta.url), "utf8");

const snapshotWithPrompt = (visual_prompt) => ({
  schema_version: 1,
  id: "project-1",
  owner_id: "user-1",
  revision: 0,
  brief: { purpose: "Launch", audience: "Customers", tone: "Warm" },
  scenes: [{
    id: "scene-1",
    order: 0,
    caption: "Launch",
    duration_ms: 1000,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "none",
    audio_level: 1,
    ducking: false,
    ...(visual_prompt === undefined ? {} : { visual_prompt })
  }]
});

test("additive v1 fields are tolerated", async () => assert.equal(acceptsFixture(await fixture("project-v1.json")), true));
test("breaking fixture version is rejected", async () => assert.equal(acceptsFixture(await fixture("project-v2-breaking.json")), false));
test("render snapshots reject malformed scenes", () => {
  assert.equal(isProjectSnapshot({
    schema_version: 1,
    id: "project-1",
    owner_id: "user-1",
    revision: 0,
    brief: { purpose: "Launch", audience: "Customers", tone: "Warm" },
    scenes: [{
      id: "scene-1",
      order: 0,
      caption: "Launch",
      duration_ms: 0,
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "none",
      audio_level: 1,
      ducking: false
    }]
  }), false);
});

test("visual_prompt is additive and accepts a trimmed search description", () => {
  assert.equal(isProjectSnapshot(snapshotWithPrompt(undefined)), true);
  assert.equal(isProjectSnapshot(snapshotWithPrompt("remote island seen from above at dusk")), true);
});

test("visual_prompt rejects blank, padded, and oversized values", () => {
  for (const prompt of ["", " padded ", "x".repeat(241)]) {
    assert.equal(isProjectSnapshot(snapshotWithPrompt(prompt)), false);
  }
});

test("title and overlay_place are additive and bounded", () => {
  const base = snapshotWithPrompt("remote island seen from above at dusk");
  const scene = base.scenes[0];
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, title: "Naplavka" }] }), true);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, overlay_place: "center" }] }), true);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, title: "Naplavka", overlay_place: "top" }] }), true);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, title: "" }] }), false);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, title: " padded " }] }), false);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, title: "x".repeat(61) }] }), false);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, overlay_place: "left" }] }), false);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, overlay_look: "poster" }] }), true);
  assert.equal(isProjectSnapshot({ ...base, scenes: [{ ...scene, overlay_look: "neon" }] }), false);
});

test("brief soundtrack is optional and validated when present", () => {
  const base = snapshotWithPrompt("remote island");
  assert.equal(isSoundtrack({ kind: "stock", stock_id: "pulse", bpm: 120, offset_ms: 0, level: 0.8 }), true);
  assert.equal(isSoundtrack({ kind: "stock", stock_id: "glow", bpm: 110, offset_ms: 0, level: 0.8 }), true);
  assert.equal(isSoundtrack({ kind: "stock", stock_id: "nope", bpm: 120, offset_ms: 0, level: 0.8 }), false);
  assert.equal(isProjectSnapshot({
    ...base,
    brief: { ...base.brief, soundtrack: { kind: "stock", stock_id: "pulse", bpm: 120, offset_ms: 0, level: 0.8 } }
  }), true);
  assert.equal(isProjectSnapshot({
    ...base,
    brief: { ...base.brief, soundtrack: { kind: "stock", stock_id: "nope", bpm: 120, offset_ms: 0, level: 0.8 } }
  }), false);
});

test("brief voiceover is optional and validated when present", () => {
  const base = snapshotWithPrompt("remote island");
  assert.equal(isVoiceover({ media_id: "vo-1", offset_ms: 0, level: 1 }), true);
  assert.equal(isVoiceover({ media_id: "", offset_ms: 0, level: 1 }), false);
  assert.equal(isProjectSnapshot({
    ...base,
    brief: { ...base.brief, voiceover: { media_id: "vo-1", offset_ms: 0, level: 0.9 } }
  }), true);
  assert.equal(isProjectSnapshot({
    ...base,
    brief: { ...base.brief, voiceover: { media_id: "vo-1", offset_ms: -1, level: 1 } }
  }), false);
});

test("storyboard lifecycle validation enforces scene count, IDs, order, and prompts", () => {
  const scene = snapshotWithPrompt("remote island").scenes[0];
  assert.equal(isStoryboardScenes([scene], true), true);
  assert.equal(isStoryboardScenes([], true), false);
  assert.equal(isStoryboardScenes(Array.from({ length: 9 }, (_, order) => ({ ...scene, id: `scene-${order}`, order })), true), false);
  assert.equal(isStoryboardScenes([scene, { ...scene, order: 1 }], true), false);
  assert.equal(isStoryboardScenes([scene, { ...scene, id: "scene-2", order: 2 }], true), false);
  assert.equal(isStoryboardScenes([{ ...scene, visual_prompt: undefined }], true), false);
});

test("openapi documents a typed host import contract", () => {
  assert.match(openapi, /ExternalProjectImport:/);
  assert.match(openapi, /EnqueueRenderRequest:/);
  assert.match(openapi, /RenderCompleteNotify:/);
  assert.match(openapi, /notify_url:/);
  assert.doesNotMatch(
    openapi,
    /\/integrations\/project-imports:[\s\S]*?schema: \{ type: object, additionalProperties: true \}/
  );
});

test("openapi documents every inventoried versioned path and typed error", () => {
  assert.match(openapi, /^openapi: 3\.1\.0/m);
  for (const route of inventory.versioned) {
    assert.match(openapi, new RegExp(`^  ${route.path.replaceAll("/", "\\/")}:`, "m"), route.path);
  }
  for (const type of inventory.error_types) {
    assert.match(openapi, new RegExp(`- ${type}\\b`));
  }
  for (const phase of inventory.sse_phases) {
    assert.match(openapi, new RegExp(`\\b${phase}\\b`));
  }
  assert.match(openapi, /url: \/api/);
  assert.match(openapi, /url: \/v1/);
});

test("shared error and media fixtures stay additive and typed", async () => {
  const incomplete = await fixture("error-render-input-incomplete.json");
  assert.equal(incomplete.type, "render_input_incomplete");
  assert.equal(typeof incomplete.message, "string");
  const capacity = await fixture("error-render-capacity.json");
  assert.equal(capacity.type, "render_capacity");
  const unauthorized = await fixture("error-unauthorized.json");
  assert.equal(unauthorized.type, "unauthorized");
  const media = await fixture("scene-media-ready.json");
  assert.equal(media.state, "ready");
  assert.equal(media.additive_client_field, true);
  const progress = await fixture("sse-progress.json");
  assert.equal(progress.phase, "preparing");
  assert.equal(progress.additive_field, "ok");
});

test("storyboard plan fixtures accept 4–6 briefs and reject invalid plans", async () => {
  const plan = await fixture("storyboard-plan-v1.json");
  assert.equal(isStoryboardPlan(plan), true);
  assert.equal(isSceneBrief(plan[0]), true);
  assert.equal(isStoryboardPlan(plan.slice(0, 3)), false);
  assert.equal(isStoryboardPlan(plan.map((brief, order) => ({
    ...brief,
    id: "dup",
    order
  }))), false);
  assert.equal(isStoryboardPlan(plan.map((brief) => ({
    ...brief,
    duration_ms: 20_000
  }))), false);
});

test("notify_url allowlists origins and signs render.complete", async () => {
  const origins = ["https://cms.example.com"];
  assert.equal(parseNotifyUrl("https://cms.example.com/hooks/fmotion", origins), "https://cms.example.com/hooks/fmotion");
  assert.equal(parseNotifyUrl("https://evil.example/hooks", origins), undefined);
  assert.equal(parseNotifyUrl("http://cms.example.com/hooks", origins), undefined);
  assert.equal(parseNotifyUrl("https://user:pass@cms.example.com/hooks", origins), undefined);
  const secret = "x".repeat(32);
  assert.deepEqual(renderNotifyConfigFromEnv({
    FENGINE_RENDER_NOTIFY_ORIGINS: "https://cms.example.com",
    FENGINE_RENDER_NOTIFY_SECRET: secret
  }), { secret, origins });
  assert.equal(renderNotifyConfigFromEnv({}), undefined);
  assert.throws(() => renderNotifyConfigFromEnv({ FENGINE_RENDER_NOTIFY_SECRET: secret }), /ORIGINS/);
  const payload = buildRenderCompleteNotify({
    jobId: "job-1",
    projectId: "project-1",
    kind: "preview",
    externalId: "cms:gallery:weekend"
  });
  assert.equal(payload.download_path, "/v1/render-jobs/job-1/download");
  const raw = JSON.stringify(payload);
  const header = signRenderNotify(raw, secret, 1_710_000_000);
  assert.equal(verifyRenderNotify(raw, header, secret, 1_710_000_000_000), true);
  assert.equal(verifyRenderNotify(raw, header, secret, 1_710_400_000_000), false);
  assert.equal(verifyRenderNotify(raw + "x", header, secret, 1_710_000_000_000), false);
  let posted;
  await deliverRenderNotify(
    { notifyUrl: "https://cms.example.com/hooks/fmotion", jobId: "job-1", projectId: "project-1", kind: "preview", externalId: "cms:gallery:weekend" },
    secret,
    origins,
    async (url, init) => {
      posted = { url: String(url), ...init };
      return new Response(null, { status: 204 });
    },
    new Date(1_710_000_000_000)
  );
  assert.equal(posted.url, "https://cms.example.com/hooks/fmotion");
  assert.equal(posted.method, "POST");
  assert.equal(posted.redirect, "error");
  assert.equal(verifyRenderNotify(posted.body, posted.headers["x-f-motion-signature"], secret, 1_710_000_000_000), true);
  assert.equal(JSON.parse(posted.body).event, "render.complete");
});

