import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  compareMedia,
  frameTolerance,
  parsePsnr,
  ratio,
  summarize,
} from "./compare_render.mjs";

const reference = {
  width: 1080,
  height: 1920,
  fps: 30,
  frames: 300,
  durationSeconds: 10,
  audio: { sampleRate: 44100, channels: 2 },
};

test("the average PSNR line is read, including an identical-picture inf", () => {
  const log = [
    "[Parsed_psnr_2 @ 0x1] PSNR y:41.20 u:44.10 v:43.90 average:41.87 min:33.1 max:50.0",
    "[Parsed_psnr_2 @ 0x1] PSNR y:inf u:inf v:inf average:inf min:inf max:inf",
    "no reading here",
  ];
  assert.equal(parsePsnr(log[0]), 41.87);
  assert.equal(parsePsnr(log[1]), Number.POSITIVE_INFINITY);
  assert.equal(parsePsnr(log[2]), null);
  assert.equal(parsePsnr(undefined), null);
});

test("frame rates arrive as rational strings", () => {
  assert.equal(ratio("30/1"), 30);
  assert.equal(ratio("30000/1001").toFixed(2), "29.97");
  assert.equal(ratio("25"), 25);
  assert.ok(Number.isNaN(ratio(undefined)));
  assert.ok(Number.isNaN(ratio("0/0")));
});

test("the duration tolerance is one frame plus muxer rounding", () => {
  assert.ok(frameTolerance(30) < 0.04);
  assert.ok(frameTolerance(30) > 0.033);
  assert.equal(frameTolerance(0), 0.05);
});

test("an ffprobe report is reduced to the compared fields", () => {
  const summary = summarize({
    streams: [
      { codec_type: "audio", sample_rate: "44100", channels: 2 },
      { codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1", nb_frames: "300" },
    ],
    format: { duration: "10.000000" },
  });
  assert.deepEqual(summary, reference);
  assert.equal(summarize({}).audio, null);
});

test("a device reel that matches the worker passes every structural check", () => {
  const checks = compareMedia(reference, reference);
  assert.deepEqual(
    checks.map((check) => [check.label, check.ok]),
    [
      ["width", true],
      ["height", true],
      ["frame rate", true],
      ["audio layout", true],
      ["duration", true],
      ["frame count", true],
    ],
  );
});

test("drift beyond one frame, a different size or a missing bed fails", () => {
  const checks = compareMedia(reference, {
    ...reference,
    width: 720,
    durationSeconds: 10.5,
    audio: null,
  });
  const failed = checks.filter((check) => !check.ok).map((check) => check.label);
  assert.deepEqual(failed, ["width", "audio layout", "duration"]);
  assert.match(checks.find((check) => check.label === "duration").detail, /drift 0\.500s/);
});

test("one extra frame of muxer rounding is tolerated", () => {
  const checks = compareMedia(reference, {
    ...reference,
    frames: 301,
    durationSeconds: 10.033,
  });
  assert.ok(checks.every((check) => check.ok));
});

test("an unknown frame count does not fail the file", () => {
  const checks = compareMedia({ ...reference, frames: 0 }, { ...reference, frames: 0 });
  const frames = checks.find((check) => check.label === "frame count");
  assert.equal(frames.ok, true);
  assert.match(frames.detail, /not reported/);
});

test("the command line refuses to run without both files", () => {
  const run = spawnSync(
    process.execPath,
    [new URL("./compare_render.mjs", import.meta.url).pathname],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 2);
  assert.match(run.stdout, /--reference <worker\.mp4> --device <phone\.mp4>/);

  const missing = spawnSync(
    process.execPath,
    [
      new URL("./compare_render.mjs", import.meta.url).pathname,
      "--reference",
      "nope.mp4",
      "--device",
      "nope-device.mp4",
    ],
    { encoding: "utf8" },
  );
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing file: nope\.mp4/);
});
