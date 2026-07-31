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
const renderInput = {
  schema_version: 1,
  id: "project",
  owner_id: "owner",
  revision: 0,
  brief,
  scenes: [scenePayload]
};

/** Fake pool that answers only the queries `handlers.render` issues, tracking `RenderJob.state`. */
function createFakePool(initialState, storedInput = renderInput, options = {}) {
  let state = initialState;
  const events = [];
  let runningUpdates = 0;
  const query = async (sql, params = []) => {
    if (sql.includes(`SELECT "renderInput", state FROM "RenderJob"`)) {
      return { rows: [{ renderInput: storedInput, state }] };
    }
    if (sql.includes(`FROM "MediaAsset"`)) return { rows: [] };
    if (sql.includes(`SET state = 'running'`)) {
      runningUpdates += 1;
      if (runningUpdates === options.cancelOnRunningUpdate) state = "cancelled";
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
    if (sql.includes(`SELECT 1 FROM "RenderJob"`) && sql.includes(`state = 'running' FOR UPDATE`)) {
      return { rowCount: state === "running" ? 1 : 0 };
    }
    if (sql.startsWith(`INSERT INTO "RenderResult"`)) return { rowCount: 1 };
    if (sql.includes(`UPDATE "RenderJob" SET state = 'complete'`)) {
      state = "complete";
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

test("invalid stored render input fails before media or FFmpeg work starts", async () => {
  const pool = createFakePool("queued", { migration_error: "historical render input unavailable" });
  let storeCalls = 0;
  const store = {
    async inspect() { storeCalls += 1; throw new Error("must not inspect"); },
    async download() { storeCalls += 1; throw new Error("must not download"); },
    async put() { storeCalls += 1; throw new Error("must not upload"); }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  assert.deepEqual(await handlers.render(
    { jobId: "job-1", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  ), { state: "failed" });
  assert.equal(pool.getState(), "failed");
  assert.equal(storeCalls, 0);
  assert.deepEqual(pool.getEvents(), [{ phase: "failed", percent: 0 }]);
});

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

test("cancellation before upload does not create an object", async () => {
  const pool = createFakePool("queued", renderInput, { cancelOnRunningUpdate: 3 });
  let uploads = 0;
  const store = {
    async inspect() { throw new Error("not used"); },
    async download() { throw new Error("not used"); },
    async put() { uploads += 1; },
    async remove() { throw new Error("nothing was uploaded"); }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  assert.deepEqual(await handlers.render(
    { jobId: "cancel-before-upload", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  ), { state: "cancelled" });
  assert.equal(uploads, 0);
  assert.equal(pool.getState(), "cancelled");
});

test("cancellation during upload removes only that execution's object", async () => {
  const pool = createFakePool("queued");
  const uploaded = [];
  const removed = [];
  const store = {
    async inspect() { throw new Error("not used"); },
    async download() { throw new Error("not used"); },
    async put(objectKey) {
      uploaded.push(objectKey);
      pool.forceState("cancelled");
    },
    async remove(objectKey) { removed.push(objectKey); }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  assert.deepEqual(await handlers.render(
    { jobId: "cancel-during-upload", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  ), { state: "cancelled" });
  assert.equal(uploaded.length, 1);
  assert.deepEqual(removed, uploaded);
  assert.match(uploaded[0], /\/cancel-during-upload\/[^/]+\.mp4$/);
  assert.equal(pool.getState(), "cancelled");
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
