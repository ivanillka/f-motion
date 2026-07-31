import test from "node:test";
import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createQueueHandlers, mediaLimitsFromEnv, renderProfileFromEnv } from "../dist/runtime.js";

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
    if (sql.includes(`FROM "MediaAsset"`)) {
      return { rows: options.mediaRow ? [options.mediaRow] : [] };
    }
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
    if (sql.includes(`SELECT 1 FROM "RenderJob"`) && sql.includes("FOR UPDATE")) {
      return { rowCount: state === "running" ? 1 : 0, rows: state === "running" ? [{ "?column?": 1 }] : [] };
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

test("render cancellation aborts a sealed download and removes its temp directory", async () => {
  const storedInput = {
    ...renderInput,
    scenes: [{ ...scenePayload, media_id: "asset" }]
  };
  const pool = createFakePool("queued", storedInput, {
    mediaRow: {
      sealedObjectKey: "sealed-object",
      sealedEtag: "sealed-etag",
      sealedVersionId: null,
      sealedSha256: "a".repeat(64),
      declaredType: "video/mp4",
      maxBytes: 100,
      detected: { type: "video/mp4", bytes: 10, width: 10, height: 10, duration_ms: 500 }
    }
  });
  const controller = new AbortController();
  let destination;
  let started;
  const downloadStarted = new Promise((resolve) => { started = resolve; });
  const store = {
    async inspect() { throw new Error("not used"); },
    async seal() { throw new Error("not used"); },
    async downloadSealed(_key, path, _identity, signal) {
      destination = path;
      assert.equal(signal, controller.signal);
      await writeFile(path, "partial");
      started();
      await new Promise((_, reject) => signal.addEventListener(
        "abort",
        () => reject(new Error("aborted")),
        { once: true }
      ));
    },
    async delete() {},
    async put() { throw new Error("not used"); }
  };
  const pending = createQueueHandlers(pool, store, profile).render(
    { jobId: "job-1", ownerId: "owner", projectId: "project", revision: 0 },
    controller.signal
  );
  await downloadStarted;
  controller.abort();
  assert.deepEqual(await pending, { state: "failed" });
  assert.equal(pool.getState(), "failed");
  await assert.rejects(stat(dirname(destination)), { code: "ENOENT" });
});

test("cancellation before upload does not create an object", async () => {
  const pool = createFakePool("queued", renderInput, { cancelOnRunningUpdate: 3 });
  let uploads = 0;
  const store = {
    async inspect() { throw new Error("not used"); },
    async download() { throw new Error("not used"); },
    async put() { uploads += 1; },
    async delete() { throw new Error("nothing was uploaded"); }
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
    async delete(objectKey) { removed.push(objectKey); }
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

test("cleanup rejection remains observable after a losing upload is terminal", async () => {
  const pool = createFakePool("queued");
  const cleanupError = new Error("render object cleanup failed");
  const store = {
    async inspect() { throw new Error("not used"); },
    async download() { throw new Error("not used"); },
    async put() { pool.forceState("cancelled"); },
    async delete() { throw cleanupError; }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  await assert.rejects(
    () => handlers.render(
      { jobId: "cleanup-failure", ownerId: "owner", projectId: "project", revision: 0 },
      new AbortController().signal
    ),
    (error) => error === cleanupError
  );
  assert.equal(pool.getState(), "cancelled");
  assert.notEqual(pool.getState(), "running");
});

test("render streams its job-scoped output and removes the upload if completion is refused", async () => {
  const pool = createFakePool("queued");
  let uploadedBytes = 0;
  let uploadedKey;
  let deleted;
  const store = {
    async inspect() { throw new Error("not used"); },
    async downloadSealed() { throw new Error("not used"); },
    async put(objectKey, body, _contentType, contentLength) {
      uploadedKey = objectKey;
      assert.equal(body instanceof Uint8Array, false);
      for await (const chunk of body) uploadedBytes += chunk.byteLength;
      assert.equal(uploadedBytes, contentLength);
      pool.forceState("cancelled");
    },
    async delete(objectKey) { deleted = objectKey; }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  assert.deepEqual(await handlers.render(
    { jobId: "job-1", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  ), { state: "cancelled" });
  assert.ok(uploadedBytes > 0);
  assert.match(uploadedKey, /projects\/project\/renders\/0\/job-1\/[^/]+\.mp4$/);
  assert.equal(deleted, uploadedKey);
});

test("render fails closed when attached media is missing instead of falling back", async () => {
  const pool = createFakePool("queued", {
    ...renderInput,
    scenes: [{ ...scenePayload, media_id: "missing" }]
  });
  let uploaded = false;
  const handlers = createQueueHandlers(pool, {
    async inspect() { throw new Error("not used"); },
    async seal() { throw new Error("not used"); },
    async downloadSealed() { throw new Error("not used"); },
    async delete() { throw new Error("not used"); },
    async put() { uploaded = true; }
  }, profile);
  assert.deepEqual(await handlers.render(
    { jobId: "job-1", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  ), { state: "failed" });
  assert.equal(uploaded, false);
});

test("render rejects a sealed-object identity mismatch", async () => {
  const pool = createFakePool(
    "queued",
    { ...renderInput, scenes: [{ ...scenePayload, media_id: "asset" }] },
    {
      mediaRow: {
        sealedObjectKey: "projects/project/media-sealed/asset",
        sealedEtag: "etag-a",
        sealedVersionId: null,
        sealedSha256: "a".repeat(64),
        declaredType: "video/mp4",
        detected: { type: "video/mp4", bytes: 42 }
      }
    }
  );
  let uploaded = false;
  const handlers = createQueueHandlers(pool, {
    async inspect() { throw new Error("not used"); },
    async seal() { throw new Error("not used"); },
    async downloadSealed() { throw new Error("sealed object identity mismatch"); },
    async delete() { throw new Error("not used"); },
    async put() { uploaded = true; }
  }, profile);
  assert.deepEqual(await handlers.render(
    { jobId: "job-1", ownerId: "owner", projectId: "project", revision: 0 },
    new AbortController().signal
  ), { state: "failed" });
  assert.equal(uploaded, false);
});

function createInspectionPool({ failReadyOnce = false } = {}) {
  const row = {
    quarantineObjectKey: "projects/project/media-quarantine/asset",
    state: "inspecting",
    declaredType: "video/mp4",
    maxBytes: 100,
    detected: null,
    inspectionEtag: null,
    inspectionVersionId: null,
    inspectionSha256: null,
    sealedObjectKey: null,
    sealedEtag: null,
    sealedVersionId: null,
    sealedSha256: null
  };
  let shouldFailReady = failReadyOnce;
  return {
    async query(sql, params = []) {
      if (sql.includes(`FROM "MediaAsset"`) && sql.includes(`state IN ('inspecting', 'ready')`)) {
        return { rows: [{ ...row }] };
      }
      if (sql.includes(`"inspectionSha256" = $4`) && sql.includes("RETURNING")) {
        row.detected = params[0];
        row.inspectionEtag = params[1];
        row.inspectionVersionId = params[2];
        row.inspectionSha256 = params[3];
        return { rowCount: 1, rows: [{ ...row }] };
      }
      if (sql.includes(`SET state = 'ready'`)) {
        if (shouldFailReady) {
          shouldFailReady = false;
          throw new Error("database unavailable after copy");
        }
        row.state = "ready";
        row.sealedObjectKey = params[0];
        row.sealedEtag = params[1];
        row.sealedVersionId = params[2];
        row.sealedSha256 = params[3];
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected inspection query: ${sql}`);
    },
    getRow: () => ({ ...row })
  };
}

test("inspection retry reuses the persisted approved identity after copy succeeds but DB update fails", async () => {
  const pool = createInspectionPool({ failReadyOnce: true });
  let inspections = 0;
  const sealedIdentities = [];
  const store = {
    async inspect() {
      inspections += 1;
      return {
        detected: { type: "video/mp4", bytes: 42, width: 720, height: 1280, duration_ms: 500 },
        identity: { etag: "etag-a", sha256: "a".repeat(64) }
      };
    },
    async seal(_source, _destination, identity) {
      sealedIdentities.push(identity);
      return { etag: "sealed-etag-a", sha256: identity.sha256 };
    },
    async delete() {},
    async downloadSealed() { throw new Error("not used"); },
    async put() { throw new Error("not used"); }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  const job = { assetId: "asset", ownerId: "owner", projectId: "project" };
  await assert.rejects(() => handlers.inspect(job, new AbortController().signal), /database unavailable/);
  assert.deepEqual(await handlers.inspect(job, new AbortController().signal), { state: "ready" });
  assert.equal(inspections, 1);
  assert.equal(sealedIdentities.length, 2);
  assert.equal(sealedIdentities[1].etag, "etag-a");
  assert.equal(pool.getRow().sealedSha256, "a".repeat(64));
});

test("inspection retry cleans quarantine after a DB-success cleanup failure", async () => {
  const pool = createInspectionPool();
  let deletes = 0;
  const store = {
    async inspect() {
      return {
        detected: { type: "video/mp4", bytes: 42, width: 720, height: 1280, duration_ms: 500 },
        identity: { etag: "etag-a", sha256: "a".repeat(64) }
      };
    },
    async seal(_source, _destination, identity) {
      return { etag: "sealed-etag-a", sha256: identity.sha256 };
    },
    async delete() {
      deletes += 1;
      if (deletes === 1) throw new Error("cleanup unavailable");
    },
    async downloadSealed() { throw new Error("not used"); },
    async put() { throw new Error("not used"); }
  };
  const handlers = createQueueHandlers(pool, store, profile);
  const job = { assetId: "asset", ownerId: "owner", projectId: "project" };
  await assert.rejects(() => handlers.inspect(job, new AbortController().signal), /cleanup unavailable/);
  assert.equal(pool.getRow().state, "ready");
  assert.deepEqual(await handlers.inspect(job, new AbortController().signal), { state: "ready" });
  assert.equal(deletes, 2);
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

test("media safety limits have conservative defaults and reject invalid startup values", () => {
  assert.deepEqual(mediaLimitsFromEnv({}), {
    maxWidth: 4096,
    maxHeight: 4096,
    maxPixels: 16_000_000,
    maxVideoDurationMs: 60_000,
    probeTimeoutMs: 10_000
  });
  assert.deepEqual(mediaLimitsFromEnv({
    MEDIA_MAX_WIDTH: "2048",
    MEDIA_MAX_HEIGHT: "3072",
    MEDIA_MAX_PIXELS: "6000000",
    MEDIA_MAX_VIDEO_DURATION_MS: "30000",
    MEDIA_PROBE_TIMEOUT_MS: "5000"
  }), {
    maxWidth: 2048,
    maxHeight: 3072,
    maxPixels: 6_000_000,
    maxVideoDurationMs: 30_000,
    probeTimeoutMs: 5000
  });
  for (const [name, value] of [
    ["MEDIA_MAX_WIDTH", "0"],
    ["MEDIA_MAX_PIXELS", "1.5"],
    ["MEDIA_PROBE_TIMEOUT_MS", "soon"]
  ]) {
    assert.throws(() => mediaLimitsFromEnv({ [name]: value }), new RegExp(name));
  }
});
