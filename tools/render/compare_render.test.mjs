import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_MIN_PSNR,
  DEFAULT_MIN_SSIM,
  compareMedia,
  frameTolerance,
  parsePsnr,
  parseSsim,
  ratio,
  sceneCuts,
  summarize,
} from "./compare_render.mjs";

const cli = new URL("./compare_render.mjs", import.meta.url).pathname;

const reference = {
  width: 1080,
  height: 1920,
  fps: 30,
  frames: 300,
  durationSeconds: 10,
  audio: { sampleRate: 44100, channels: 2 },
};

const sameCut = { reference: 2, device: 2 };

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

test("the luma SSIM line is read, not the all-plane average", () => {
  const log = "[Parsed_ssim_9 @ 0x1] SSIM Y:0.999817 (37.380769) U:1.000000 (inf) " +
    "V:1.000000 (inf) All:0.999878 (39.141682)";
  assert.equal(parseSsim(log), 0.999817);
  assert.equal(parseSsim("no reading here"), null);
  assert.equal(parseSsim(undefined), null);
});

test("scene cuts are the times scdet flags, merged per transition", () => {
  const log = [
    "[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 15.625, lavfi.scd.time: 0.5",
    "[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 31.25, lavfi.scd.time: 1.9",
    "[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 12.5, lavfi.scd.time: 1.933",
    "[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 44.0, lavfi.scd.time: 4.2",
  ].join("\n");
  assert.deepEqual(sceneCuts(log), [0.5, 1.9, 4.2]);
  assert.deepEqual(sceneCuts("no cuts here"), []);
  assert.deepEqual(sceneCuts(undefined), []);
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
  const checks = compareMedia(reference, reference, sameCut);
  assert.deepEqual(
    checks.map((check) => [check.label, check.ok]),
    [
      ["width", true],
      ["height", true],
      ["frame rate", true],
      ["audio stream", true],
      ["audio layout", true],
      ["duration", true],
      ["frame count", true],
      ["scene count", true],
    ],
  );
});

test("drift beyond one frame, a different size or a missing bed fails", () => {
  const checks = compareMedia(reference, {
    ...reference,
    width: 720,
    durationSeconds: 10.5,
    audio: null,
  }, { reference: 2, device: 3 });
  const failed = checks.filter((check) => !check.ok).map((check) => check.label);
  assert.deepEqual(
    failed,
    ["width", "audio stream", "audio layout", "duration", "scene count"],
  );
  assert.match(checks.find((check) => check.label === "duration").detail, /drift 0\.500s/);
});

test("a reel without an audio stream fails even when both files lack one", () => {
  const checks = compareMedia(
    { ...reference, audio: null },
    { ...reference, audio: null },
    sameCut,
  );
  const audio = checks.find((check) => check.label === "audio stream");
  assert.equal(audio.ok, false);
  assert.match(audio.detail, /missing vs missing/);
});

test("an unmeasured scene count fails instead of passing silently", () => {
  const checks = compareMedia(reference, reference);
  const scenes = checks.find((check) => check.label === "scene count");
  assert.equal(scenes.ok, false);
  assert.match(scenes.detail, /not measured/);
});

test("one extra frame of muxer rounding is tolerated", () => {
  const checks = compareMedia(reference, {
    ...reference,
    frames: 301,
    durationSeconds: 10.033,
  }, sameCut);
  assert.ok(checks.every((check) => check.ok));
});

test("an unknown frame count does not fail the file", () => {
  const checks = compareMedia(
    { ...reference, frames: 0 },
    { ...reference, frames: 0 },
    sameCut,
  );
  const frames = checks.find((check) => check.label === "frame count");
  assert.equal(frames.ok, true);
  assert.match(frames.detail, /not reported/);
});

test("the command line refuses to run without both files", () => {
  const run = spawnSync(process.execPath, [cli], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /--reference <worker\.mp4> --device <phone\.mp4>/);

  const missing = spawnSync(
    process.execPath,
    [cli, "--reference", "nope.mp4", "--device", "nope-device.mp4"],
    { encoding: "utf8" },
  );
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /missing file: nope\.mp4/);
});

test("--help exits 0 and documents both provisional gates", () => {
  const run = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /--min-psnr <dB>/);
  assert.match(run.stdout, /--min-ssim <n>/);
  assert.match(run.stdout, /Provisional/);
  assert.equal(DEFAULT_MIN_PSNR, 28);
  assert.equal(DEFAULT_MIN_SSIM, 0.95);
});

test("a gate that is not a number is a usage error", () => {
  const run = spawnSync(
    process.execPath,
    [cli, "--reference", "ref.mp4", "--device", "dev.mp4", "--min-psnr", "lots"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--min-psnr needs a number, got lots/);
});

const ffmpegReady = ["ffmpeg", "ffprobe"].every(
  (command) => spawnSync(command, ["-version"]).status === 0,
);

/**
 * Writes a reel of flat colour scenes with one cut between each, so scene
 * detection has something exact to count. `quality` is the MPEG-4 quantizer:
 * a higher number is a worse picture, which is how the gates get exercised.
 */
function reel(directory, name, colors, { quality = 3, audio = true } = {}) {
  const inputs = colors.flatMap((color) => [
    "-f", "lavfi", "-i", `color=c=${color}:size=64x64:rate=30:duration=0.5`,
  ]);
  const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", ...inputs];
  if (audio) {
    args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${colors.length * 0.5}`);
  }
  args.push(
    "-filter_complex",
    `${colors.map((_, index) => `[${index}:v]`).join("")}` +
      `concat=n=${colors.length}:v=1:a=0[v]`,
    "-map", "[v]",
  );
  if (audio) args.push("-map", `${colors.length}:a`, "-c:a", "aac", "-shortest");
  args.push("-c:v", "mpeg4", "-q:v", String(quality), join(directory, name));
  const written = spawnSync("ffmpeg", args, { encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  return join(directory, name);
}

function compare(directory, referencePath, devicePath, extra = []) {
  return spawnSync(
    process.execPath,
    [
      cli,
      "--reference", referencePath,
      "--device", devicePath,
      "--json", join(directory, "report.json"),
      ...extra,
    ],
    { encoding: "utf8" },
  );
}

test("a re-encoded reel with the same cut matches and prints both gates", { skip: !ffmpegReady }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-compare-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = reel(directory, "worker.mp4", ["red", "blue"]);
  const device = reel(directory, "device.mp4", ["red", "blue"], { quality: 8 });

  const run = compare(directory, worker, device);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /PSNR\s+\d+\.\d+ dB/);
  assert.match(run.stdout, /SSIM\s+0\.\d+ luma/);
  assert.match(run.stdout, /MATCH$/m);

  const report = JSON.parse(await readFile(join(directory, "report.json"), "utf8"));
  assert.equal(report.ok, true);
  assert.deepEqual(report.thresholds, { minPsnr: 28, minSsim: 0.95, provisional: true });
  assert.deepEqual(report.sceneCuts, { reference: 1, device: 1 });
});

test("--min-psnr is the gate and the failure names it", { skip: !ffmpegReady }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-compare-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = reel(directory, "worker.mp4", ["red", "blue"]);
  const device = reel(directory, "device.mp4", ["red", "blue"], { quality: 8 });

  const run = compare(directory, worker, device, ["--min-psnr", "200"]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /FAIL picture PSNR:/);
  assert.match(run.stdout, /MISMATCH: picture PSNR/);
});

test("--min-ssim is the gate and the failure names it", { skip: !ffmpegReady }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-compare-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = reel(directory, "worker.mp4", ["red", "blue"]);
  const device = reel(directory, "device.mp4", ["red", "blue"], { quality: 12 });

  const run = compare(directory, worker, device, ["--min-psnr", "0", "--min-ssim", "1"]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /FAIL picture SSIM:/);
  assert.match(run.stdout, /MISMATCH: picture SSIM/);
});

test("a different cut fails on duration, frame count and scene count", { skip: !ffmpegReady }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-compare-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = reel(directory, "worker.mp4", ["red", "blue"]);
  const device = reel(directory, "device.mp4", ["red", "blue", "green"], { quality: 8 });

  const run = compare(directory, worker, device);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /FAIL duration:/);
  assert.match(run.stdout, /FAIL frame count:/);
  assert.match(run.stdout, /FAIL scene count: 1 vs 2 scene changes/);
  assert.match(run.stdout, /MISMATCH: .*duration.*frame count.*scene count/);
});
