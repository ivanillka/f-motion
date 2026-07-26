import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdempotentResults, ffmpegArguments, inspectMedia, renderObjectKey, renderPhases, renderPreview } from "../dist/index.js";

const snapshot = {
  schema_version: 1,
  id: "project",
  owner_id: "owner",
  revision: 3,
  brief: { purpose: "Demo", audience: "Teams", tone: "Warm" },
  scenes: [{
    id: "scene-1",
    order: 0,
    caption: "Project caption",
    duration_ms: 500,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "none",
    audio_level: 1,
    ducking: false
  }]
};

test("media-inspection rejects mismatch and oversize", () => {
  assert.equal(inspectMedia("video/mp4", "image/png", 10, 10).accepted, false);
  assert.equal(inspectMedia("video/mp4", "video/mp4", 11, 10).accepted, false);
});
test("render progress has named phases", () => assert.deepEqual(renderPhases, ["queued", "preparing", "rendering", "uploading", "complete"]));
test("render result is idempotent and immutable", () => {
  const results = new IdempotentResults();
  const first = results.complete("job", { key: renderObjectKey("p", 1) });
  assert.equal(results.complete("job", { key: "wrong" }), first);
  assert.equal(Object.isFrozen(first), true);
});
test("queue recovery contract uses idempotent result key", () => {
  const results = new IdempotentResults();
  results.complete("leased-job", { worker: "killed" });
  assert.equal(results.complete("leased-job", { worker: "replacement" }).worker, "killed");
});
test("render arguments come from the deterministic project plan", () => {
  const args = ffmpegArguments(snapshot, "preview.mp4").join(" ");
  assert.match(args, /720x1280/);
  assert.match(args, /Project caption/);
  assert.match(args, /F-Motion preview/);
  assert.match(args, /project project revision 3/);
});
test("cancellation removes partial output and rejects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-cancel-"));
  const output = join(directory, "preview.mp4");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderPreview(output, snapshot, controller.signal));
  await assert.rejects(readFile(output), { code: "ENOENT" });
});
test("worker renders the 720p accurate preview outside the API", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-render-"));
  const output = join(directory, "preview.mp4");
  await renderPreview(output, snapshot);
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
});
