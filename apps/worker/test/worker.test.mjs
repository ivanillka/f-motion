import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IdempotentResults,
  ffmpegArguments,
  inspectMedia,
  probeMediaFile,
  renderObjectKey,
  renderPhases,
  renderPreview
} from "../dist/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

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

test("media-inspection rejects mismatch, oversize, and incomplete facts", () => {
  assert.equal(inspectMedia("video/mp4", { type: "image/png", bytes: 10, width: 1, height: 1 }, 10).accepted, false);
  assert.equal(inspectMedia("video/mp4", { type: "video/mp4", bytes: 11, width: 1, height: 1, duration_ms: 100 }, 10).accepted, false);
  assert.equal(inspectMedia("video/mp4", { type: "video/mp4", bytes: 10, width: 1, height: 1 }, 10).accepted, false);
  assert.equal(inspectMedia("image/jpeg", { type: "image/jpeg", bytes: 10, width: 0, height: 10 }, 10).accepted, false);
  assert.equal(inspectMedia("video/mp4", {
    type: "video/mp4",
    bytes: 10,
    width: 64,
    height: 64,
    duration_ms: 100
  }, 10).accepted, true);
  assert.equal(inspectMedia("image/png", { type: "image/png", bytes: 10, width: 64, height: 64 }, 10).accepted, true);
});

test("ffprobe accepts fixture media and rejects corrupt bytes", async () => {
  const video = await probeMediaFile(join(fixtures, "scene_one.mp4"));
  assert.equal(video.type, "video/mp4");
  assert.ok(video.width && video.width > 0);
  assert.ok(video.height && video.height > 0);
  assert.ok(video.duration_ms && video.duration_ms > 0);
  assert.equal(inspectMedia("video/mp4", { ...video, bytes: 1000 }, 1000).accepted, true);

  const jpeg = await probeMediaFile(join(fixtures, "still.jpg"));
  assert.equal(jpeg.type, "image/jpeg");
  assert.equal(inspectMedia("image/jpeg", { ...jpeg, bytes: 100 }, 100).accepted, true);

  const png = await probeMediaFile(join(fixtures, "still.png"));
  assert.equal(png.type, "image/png");

  await assert.rejects(probeMediaFile(join(fixtures, "corrupt.bin")));
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
  assert.match(args, /color=c=#202027/);
});
test("render arguments use attached media input when provided", () => {
  const withMedia = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1" }]
  };
  const args = ffmpegArguments(withMedia, "preview.mp4", {
    "asset-1": { path: "/tmp/media.mp4", type: "video/mp4" }
  }).join(" ");
  assert.match(args, /\/tmp\/media\.mp4/);
  assert.doesNotMatch(args, /color=c=#202027/);
  assert.match(args, /force_original_aspect_ratio=increase/);
});
test("render arguments crop around the scene's focal point", () => {
  const withFocal = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1", focal_x: 0.8, focal_y: 0.2 }]
  };
  const args = ffmpegArguments(withFocal, "preview.mp4", {
    "asset-1": { path: "/tmp/media.mp4", type: "video/mp4" }
  }).join(" ");
  assert.match(args, /crop=720:1280:\(iw-ow\)\*0\.8:\(ih-oh\)\*0\.2/);
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
test("worker renders attached fixture media into the preview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-media-render-"));
  const output = join(directory, "preview.mp4");
  const withMedia = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1", duration_ms: 500 }]
  };
  await renderPreview(output, withMedia, undefined, {
    "asset-1": { path: join(fixtures, "scene_one.mp4"), type: "video/mp4" }
  });
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
});
