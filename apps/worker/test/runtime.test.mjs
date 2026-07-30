import test from "node:test";
import assert from "node:assert/strict";
import { createQueueHandlers, renderProfileFromEnv } from "../dist/runtime.js";

const profile = { width: 720, height: 1280 };

const brief = { purpose: "Demo", audience: "Teams", tone: "Warm" };
const scenePayload = {
  id: "scene-1",
  order: 0,
  caption: "Fixture caption",
  duration_ms: 500,
  focal_x: 0.5,
  focal_y: 0.5,
  motion: "none",
  audio_level: 1,
  ducking: false
};

/** Fake pool that answers only the queries `handlers.render` issues, tracking `RenderJob.state`. */
function createFakePool(initialState) {
  let state = initialState;
  const events = [];
  const query = async (sql, params = []) => {
    if (sql.includes(`FROM "RenderJob" j JOIN "Project" p`)) {
      if (state === "cancelled") return { rows: [] };
      return { rows: [{ id: "project", ownerId: "owner", revision: 0, brief, state }] };
    }
    if (sql.includes(`FROM "Scene"`)) return { rows: [{ position: 0, payload: scenePayload }] };
    if (sql.includes(`FROM "MediaAsset"`)) return { rows: [] };
    if (sql.includes(`SET state = 'running'`)) {
      if (state === "queued" || state === "running") { state = "running"; return { rowCount: 1 }; }
      return { rowCount: 0 };
    }
    if (sql.includes(`SET state = 'failed'`)) {
      if (state === "queued" || state === "running") { state = "failed"; return { rowCount: 1 }; }
      return { rowCount: 0 };
    }
    if (sql.startsWith(`INSERT INTO "RenderEvent"`)) {
      const literal = sql.includes(`'failed', 0`);
      events.push({ phase: literal ? "failed" : params[1], percent: literal ? 0 : params[2] });
      return { rowCount: 1 };
    }
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    throw new Error(`unexpected query in fake pool: ${sql}`);
  };
  return {
    query,
    connect: async () => ({ query, release() {} }),
    getState: () => state,
    forceState: (next) => { state = next; },
    getEvents: () => events
  };
}

test("render persists a failed state and event when upload fails after rendering starts", async () => {
  const pool = createFakePool("queued");
  const store = {
    async inspect() { throw new Error("not used"); },
    async download() { throw new Error("not used"); },
    async put() { throw new Error("upload failed"); }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  const result = await handlers.render(
    { jobId: "job-1", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  );
  assert.deepEqual(result, { state: "failed" });
  assert.equal(pool.getState(), "failed");
  assert.ok(pool.getEvents().some((event) => event.phase === "failed" && event.percent === 0));
});

test("render does not overwrite a job already cancelled by the time the failure is persisted", async () => {
  const pool = createFakePool("queued");
  const store = {
    async inspect() { throw new Error("not used"); },
    async download() { throw new Error("not used"); },
    async put() {
      // simulate a concurrent /cancel landing between "uploading" and the upload throwing
      pool.forceState("cancelled");
      throw new Error("upload failed");
    }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  const result = await handlers.render(
    { jobId: "job-1", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  );
  assert.deepEqual(result, { state: "failed" });
  assert.equal(pool.getState(), "cancelled");
  assert.equal(pool.getEvents().some((event) => event.phase === "failed"), false);
});

test("reference render profile defaults and rejects invalid startup values", () => {
  assert.deepEqual(renderProfileFromEnv({}), { width: 720, height: 1280 });
  assert.deepEqual(
    renderProfileFromEnv({
      RENDER_WIDTH: "1080",
      RENDER_HEIGHT: "1920",
      RENDER_WATERMARK: "Reference"
    }),
    { width: 1080, height: 1920, watermark: "Reference" }
  );
  assert.throws(
    () => renderProfileFromEnv({ RENDER_WIDTH: "wide" }),
    /dimensions/
  );
});
