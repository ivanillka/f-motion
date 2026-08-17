import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPlan } from "@f-engine/reel-engine";
import {
  IdempotentResults,
  MediaProbeError,
  buildCaptionAss,
  buildRenderJob as buildRenderJobWithProfile,
  inspectMedia,
  probeMediaFile,
  renderObjectKey,
  renderPhases,
  renderPreview as renderPreviewWithProfile,
  stockBedPath
} from "../dist/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const referenceProfile = { width: 720, height: 1280, watermark: "Reference preview" };
const buildRenderJob = (snapshot, output, media, directory) =>
  buildRenderJobWithProfile(snapshot, output, media, directory, referenceProfile);
const renderPreview = (output, snapshot, signal, media = {}) =>
  renderPreviewWithProfile(output, snapshot, signal, media, referenceProfile);

async function waitForText(path) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("probe fixture did not start");
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("probe fixture cleanup exceeded deadline");
}

async function withControllableProbe(run, { ignoreSigterm = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "fengine-probe-process-"));
  const executable = join(directory, "ffprobe");
  const pidPath = join(directory, "probe.pid");
  const originalPath = process.env.PATH;
  await writeFile(executable, `#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require("node:fs");
const target = process.argv.at(-1);
const ignoreSigterm = ${JSON.stringify(ignoreSigterm)};
writeFileSync(target, String(process.pid));
process.on("SIGTERM", () => {
  appendFileSync(target + ".signals", "term\\n");
  if (!ignoreSigterm) process.exit(0);
});
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  process.env.PATH = `${directory}:${originalPath ?? ""}`;
  try {
    await run(pidPath);
  } finally {
    process.env.PATH = originalPath;
    try {
      let pid;
      try {
        pid = Number(await readFile(pidPath, "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
        await waitForProcessExit(pid);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function probeAudioStream(path) {
  const raw = await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name",
      "-of", "json",
      path
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`ffprobe exited ${code}`)));
  });
  const parsed = JSON.parse(raw);
  return (parsed.streams ?? []).find((stream) => stream.codec_type === "audio");
}

async function frameHash(path) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-v", "error",
      "-ss", "0.25",
      "-i", path,
      "-frames:v", "1",
      "-f", "hash",
      "-hash", "sha256",
      "-"
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`ffmpeg exited ${code}`)));
  });
}

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
  assert.equal(inspectMedia("image/webp", { type: "image/webp", bytes: 10, width: 64, height: 64 }, 10).accepted, true);
  assert.equal(inspectMedia("image/jpeg", { type: "image/webp", bytes: 10, width: 64, height: 64 }, 10).accepted, true);
  assert.equal(inspectMedia("image/png", { type: "image/jpeg", bytes: 10, width: 64, height: 64 }, 10).accepted, true);
  assert.equal(inspectMedia("image/jpeg", {
    type: "video/mp4",
    bytes: 10,
    width: 64,
    height: 64,
    duration_ms: 100
  }, 10).accepted, false);
});

test("media-inspection enforces each configured dimension, pixel, and duration boundary", () => {
  const limits = {
    maxWidth: 100,
    maxHeight: 200,
    maxPixels: 10_000,
    maxVideoDurationMs: 1000,
    probeTimeoutMs: 100
  };
  const image = (width, height) => ({ type: "image/png", bytes: 10, width, height });
  const video = (duration_ms) => ({ type: "video/mp4", bytes: 10, width: 10, height: 10, duration_ms });

  assert.equal(inspectMedia("image/png", image(100, 1), 10, limits).accepted, true);
  assert.equal(inspectMedia("image/png", image(101, 1), 10, limits).accepted, false);
  assert.equal(inspectMedia("image/png", image(1, 200), 10, limits).accepted, true);
  assert.equal(inspectMedia("image/png", image(1, 201), 10, limits).accepted, false);
  assert.equal(inspectMedia("image/png", image(100, 100), 10, limits).accepted, true);
  assert.equal(inspectMedia("image/png", image(100, 101), 10, limits).accepted, false);
  assert.equal(inspectMedia("video/mp4", video(1000), 10, limits).accepted, true);
  assert.equal(inspectMedia("video/mp4", video(1001), 10, limits).accepted, false);
});

test("ffprobe abort terminates once, awaits exit, and returns a typed non-sensitive error", async () => {
  await withControllableProbe(async (pidPath) => {
    const controller = new AbortController();
    const pending = probeMediaFile(pidPath, controller.signal, 5000);
    const pid = Number(await waitForText(pidPath));
    controller.abort();
    await assert.rejects(pending, (error) => {
      assert.ok(error instanceof MediaProbeError);
      assert.equal(error.code, "aborted");
      assert.doesNotMatch(error.message, new RegExp(pidPath));
      return true;
    });
    assert.equal(await readFile(`${pidPath}.signals`, "utf8"), "term\n");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  });
});

test("ffprobe deadline terminates and awaits a controllable process", async () => {
  await withControllableProbe(async (pidPath) => {
    // Keep timeout short, but long enough for the stub process to write its pid.
    const pending = probeMediaFile(pidPath, undefined, 250);
    const rejected = assert.rejects(pending, (error) => {
      assert.ok(error instanceof MediaProbeError);
      assert.equal(error.code, "timeout");
      return true;
    });
    const pid = Number(await waitForText(pidPath));
    await rejected;
    assert.equal(await readFile(`${pidPath}.signals`, "utf8"), "term\n");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  });
});

test("ffprobe deadline forcibly kills a process that ignores graceful termination", async () => {
  await withControllableProbe(async (pidPath) => {
    const startedAt = Date.now();
    const pending = probeMediaFile(pidPath, undefined, 100);
    const rejected = assert.rejects(pending, (error) => {
      assert.ok(error instanceof MediaProbeError);
      assert.equal(error.code, "timeout");
      return true;
    });
    const pid = Number(await waitForText(pidPath));
    let settlementTimer;
    const bounded = new Promise((resolve, reject) => {
      settlementTimer = setTimeout(() => reject(new Error("forced probe termination did not settle")), 2500);
      rejected.then(resolve, reject);
    });
    try {
      await bounded;
    } finally {
      clearTimeout(settlementTimer);
    }
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 1000, `expected SIGKILL grace period, settled after ${elapsed}ms`);
    assert.ok(elapsed < 2500, `expected bounded SIGKILL cleanup, settled after ${elapsed}ms`);
    assert.equal(await readFile(`${pidPath}.signals`, "utf8"), "term\n");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }, { ignoreSigterm: true });
});

test("ffprobe accepts fixture media and rejects corrupt bytes", async () => {
  const video = await probeMediaFile(join(fixtures, "scene_one.mp4"));
  assert.equal(video.type, "video/mp4");
  assert.ok(video.width && video.width > 0);
  assert.ok(video.height && video.height > 0);
  assert.ok(video.duration_ms && video.duration_ms > 0);
  assert.equal(video.has_audio, true);
  assert.equal(inspectMedia("video/mp4", { ...video, bytes: 1000 }, 1000).accepted, true);

  const jpeg = await probeMediaFile(join(fixtures, "still.jpg"));
  assert.equal(jpeg.type, "image/jpeg");
  assert.equal(jpeg.has_audio, false);
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
test("render job builds one deterministic-plan clip per scene", () => {
  const job = buildRenderJob(snapshot, "preview.mp4", {}, "/tmp/job");
  assert.equal(job.clips.length, 1);
  const args = job.clips[0].args.join(" ");
  assert.match(args, /720x1280/);
  assert.match(args, /color=c=#202027/);
  assert.match(args, /subtitles=/);
  assert.match(job.clips[0].assContents ?? "", /Project caption/);
  const concat = job.concatArgs.join(" ");
  assert.match(concat, /Reference preview/);
  assert.match(concat, /project project revision 3/);
  assert.match(args, /-c:a aac/);
  assert.match(concat, /-c:a aac/);
  assert.doesNotMatch(args, /-an/);
  assert.doesNotMatch(concat, /-an/);
  assert.match(args, /-c:v h264/);
  assert.match(concat, /-c:v h264/);
});

test("host profile controls dimensions, watermark, and neutral metadata", () => {
  const custom = buildRenderJobWithProfile(
    snapshot,
    "preview.mp4",
    {},
    "/tmp/job",
    { width: 1080, height: 1920 }
  );
  assert.match(custom.clips[0].args.join(" "), /1080x1920/);
  assert.doesNotMatch(custom.concatArgs.join(" "), /drawtext|drawbox/);
  assert.match(custom.concatArgs.join(" "), /comment=project project revision 3/);
});
test("render job applies volume filter for non-1.0 audio_level", () => {
  const half = { ...snapshot, scenes: [{ ...snapshot.scenes[0], audio_level: 0.5 }] };
  const job = buildRenderJob(half, "preview.mp4", {}, "/tmp/job");
  assert.match(job.clips[0].args.join(" "), /volume=0\.5/);
});
test("render job keeps a zero audio_level as a muted stream, not stripped", () => {
  const muted = { ...snapshot, scenes: [{ ...snapshot.scenes[0], audio_level: 0 }] };
  const job = buildRenderJob(muted, "preview.mp4", {}, "/tmp/job");
  const args = job.clips[0].args.join(" ");
  assert.match(args, /volume=0[^.\d]|volume=0$/);
  assert.match(args, /anullsrc=/);
  assert.match(args, /-c:a aac/);
});
test("render job omits subtitles when caption is empty", () => {
  const noCaption = { ...snapshot, scenes: [{ ...snapshot.scenes[0], caption: "" }] };
  const job = buildRenderJob(noCaption, "preview.mp4", {}, "/tmp/job");
  assert.doesNotMatch(job.clips[0].args.join(" "), /subtitles=/);
  assert.equal(job.clips[0].assPath, undefined);
  assert.match(job.concatArgs.join(" "), /Reference preview/, "watermark-only path unchanged");
});
test("caption ass builder freezes the safe-area layout", () => {
  const ass = buildCaptionAss([{ text: "Project caption", start_ms: 0, end_ms: 500 }]);
  assert.match(ass, /PlayResX: 720/);
  assert.match(ass, /PlayResY: 1280/);
  assert.match(ass, /Style: Caption,.*,40,40,140,1$/m, "40px side inset, 140px bottom margin clears the watermark band");
  assert.match(ass, /&H40000000/, "panel BackColour alpha 0x40 is ~75% opaque, above the 0.55 floor");
  assert.match(ass, /^Dialogue: 0,0:00:00\.00,0:00:00\.50,Caption,,0,0,0,,Project caption$/m);
});
test("title overlay burns above the caption and honors place", () => {
  const stacked = buildCaptionAss(
    [{ text: "Open the full gallery.", start_ms: 0, end_ms: 500 }],
    { title: "Naplavka", durationMs: 500 }
  );
  const lines = stacked.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Title,,0,0,228,,Naplavka$/);
  assert.match(lines[1], /Caption,,0,0,0,,Open the full gallery\.$/);
  const centered = buildCaptionAss([], { title: "Naplavka", place: "center", durationMs: 1000 });
  assert.match(centered, /\{\\an8\}Naplavka/);
  assert.doesNotMatch(centered, /^Dialogue:.*Caption,/m);
  const titleLook = buildCaptionAss(
    [{ text: "Open the full gallery.", start_ms: 0, end_ms: 500 }],
    { look: "title", caption: "Open the full gallery.", durationMs: 500 }
  );
  assert.match(titleLook, /Title,,0,0,560,,\{\\an8\}Open the full gallery\./);
  assert.doesNotMatch(titleLook, /^Dialogue:.*Caption,/m);
});
test("title-only scene still gets a subtitle filter", () => {
  const job = buildRenderJob({
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], caption: "", title: "Naplavka" }]
  }, "preview.mp4", {}, "/tmp/job");
  assert.match(job.clips[0].args.join(" "), /subtitles=/);
  assert.match(job.clips[0].assContents ?? "", /Title,,0,0,0,,Naplavka/);
});
test("caption ass builder emits one Dialogue line per timed cue", () => {
  const ass = buildCaptionAss([
    { text: "First phrase", start_ms: 0, end_ms: 1500 },
    { text: "Second phrase", start_ms: 1500, end_ms: 4000 }
  ]);
  const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogues.length, 2);
  assert.match(dialogues[0], /^Dialogue: 0,0:00:00\.00,0:00:01\.50,Caption,,0,0,0,,First phrase$/);
  assert.match(dialogues[1], /^Dialogue: 0,0:00:01\.50,0:00:04\.00,Caption,,0,0,0,,Second phrase$/);
});
test("caption ass builder neutralizes characters that would corrupt the ASS document", () => {
  const ass = buildCaptionAss([{ text: "100% {ok} [x], don't", start_ms: 0, end_ms: 500 }]);
  const dialogue = ass.split("\n").find((line) => line.startsWith("Dialogue:"));
  assert.ok(dialogue, "dialogue line present");
  assert.match(dialogue, /100% /);
  assert.match(dialogue, /\[x\]/);
  assert.match(dialogue, /,/);
  assert.match(dialogue, /don't/);
  assert.doesNotMatch(dialogue, /\{ok\}/, "literal braces would open an ASS override tag");
  assert.match(dialogue, /\(ok\)/, "braces are swapped for parens in the same font, avoiding a panel seam");
});
test("caption ass builder neutralizes backslashes and hard newlines", () => {
  const ass = buildCaptionAss([{ text: "back\\slash\nline two", start_ms: 0, end_ms: 500 }]);
  const dialogue = ass.split("\n").find((line) => line.startsWith("Dialogue:"));
  assert.doesNotMatch(dialogue, /back\\slash/, "raw backslash could start a \\N/\\n/\\h override code");
  assert.match(dialogue, /back\/slash/);
  assert.match(dialogue, /\\Nline two/, "real newlines become the ASS forced-break code");
});
test("caption near the 180-char limit still produces a non-empty dialogue line", () => {
  const long = "x".repeat(179);
  const ass = buildCaptionAss([{ text: long, start_ms: 0, end_ms: 500 }]);
  const dialogue = ass.split("\n").find((line) => line.startsWith("Dialogue:"));
  assert.match(dialogue, new RegExp(`${long}$`));
});
test("render job clip uses attached media input when provided", () => {
  const withMedia = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1" }]
  };
  const job = buildRenderJob(withMedia, "preview.mp4", {
    "asset-1": { path: "/tmp/media.mp4", type: "video/mp4" }
  }, "/tmp/job");
  const args = job.clips[0].args.join(" ");
  assert.match(args, /\/tmp\/media\.mp4/);
  assert.match(args, /-stream_loop -1/, "short B-roll must fill the authoritative scene duration");
  assert.doesNotMatch(args, /color=c=#202027/);
  assert.match(args, /force_original_aspect_ratio=increase/);
  assert.match(args, /-map 0:a/);
  assert.doesNotMatch(args, /anullsrc=/);
});
test("render job pads silent video with anullsrc and maps 1:a", () => {
  const withMedia = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1" }]
  };
  const job = buildRenderJob(withMedia, "preview.mp4", {
    "asset-1": { path: "/tmp/silent.mp4", type: "video/mp4", hasAudio: false }
  }, "/tmp/job");
  const args = job.clips[0].args.join(" ");
  assert.match(args, /anullsrc=/);
  assert.match(args, /-map 1:a/);
  assert.doesNotMatch(args, /-map 0:a/);
});
test("render job maps video audio from 0:a when hasAudio is true", () => {
  const withMedia = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1" }]
  };
  const job = buildRenderJob(withMedia, "preview.mp4", {
    "asset-1": { path: "/tmp/media.mp4", type: "video/mp4", hasAudio: true }
  }, "/tmp/job");
  const args = job.clips[0].args.join(" ");
  assert.match(args, /-map 0:a/);
  assert.doesNotMatch(args, /anullsrc=/);
});
test("render job clip crops around the scene's focal point", () => {
  const withFocal = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1", focal_x: 0.8, focal_y: 0.2 }]
  };
  const job = buildRenderJob(withFocal, "preview.mp4", {
    "asset-1": { path: "/tmp/media.mp4", type: "video/mp4" }
  }, "/tmp/job");
  assert.match(job.clips[0].args.join(" "), /crop=720:1280:\(iw-ow\)\*0\.8:\(ih-oh\)\*0\.2/);
});
test("zoom motion adds a bounded zoompan filter; none omits it", () => {
  const zoomJob = buildRenderJob({
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], motion: "zoom" }]
  }, "preview.mp4", {}, "/tmp/job");
  assert.match(zoomJob.clips[0].args.join(" "), /zoompan/);

  const noneJob = buildRenderJob(snapshot, "preview.mp4", {}, "/tmp/job");
  assert.doesNotMatch(noneJob.clips[0].args.join(" "), /zoompan/);
});
test("push motion pans within the frame instead of a no-op", () => {
  const pushJob = buildRenderJob({
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], motion: "push" }]
  }, "preview.mp4", {}, "/tmp/job");
  assert.match(pushJob.clips[0].args.join(" "), /zoompan/);
});
test("push pans sideways on a wide still and vertically on a tall still", () => {
  const scene = { ...snapshot.scenes[0], motion: "push", media_id: "asset-1" };
  const wide = buildRenderJob({ ...snapshot, scenes: [scene] }, "preview.mp4", {
    "asset-1": { path: "/tmp/wide.jpg", type: "image/jpeg", width: 1920, height: 1080 }
  }, "/tmp/job");
  assert.match(wide.clips[0].args.join(" "), /\(iw-iw\/zoom\)\*on\//);
  const tall = buildRenderJob({ ...snapshot, scenes: [scene] }, "preview.mp4", {
    "asset-1": { path: "/tmp/tall.jpg", type: "image/jpeg", width: 1080, height: 1920 }
  }, "/tmp/job");
  assert.match(tall.clips[0].args.join(" "), /\(ih-ih\/zoom\)\*on\//);
});
test("concat mixdown amixes an uploaded soundtrack under the cut", () => {
  const withBed = {
    ...snapshot,
    brief: {
      ...snapshot.brief,
      soundtrack: { kind: "upload", media_id: "bed", bpm: 120, offset_ms: 0, level: 0.4 }
    }
  };
  const job = buildRenderJob(withBed, "preview.mp4", {
    bed: { path: "/tmp/bed.mp3", type: "audio/mpeg" }
  }, "/tmp/job");
  const concat = job.concatArgs.join(" ");
  assert.match(concat, /amix=/);
  assert.match(concat, /volume=0\.4/);
  assert.match(concat, /\/tmp\/bed.mp3/);
  assert.match(concat, /-stream_loop -1/);
});
test("concat mixdown uses the licensed catalog file for a stock bed", () => {
  assert.match(stockBedPath("pulse") ?? "", /pulse\.mp3$/);
  const withBed = {
    ...snapshot,
    brief: {
      ...snapshot.brief,
      soundtrack: { kind: "stock", stock_id: "pulse", bpm: 115, offset_ms: 0, level: 0.8 }
    }
  };
  const job = buildRenderJob(withBed, "preview.mp4", {}, "/tmp/job");
  const concat = job.concatArgs.join(" ");
  assert.match(concat, /amix=/);
  assert.match(concat, /pulse\.mp3/);
  assert.match(concat, /Funkorama/);
  assert.match(concat, /Kevin MacLeod/);
});
test("render job sorts scenes by order and gives each its own clip", () => {
  const twoScenes = {
    ...snapshot,
    scenes: [
      { ...snapshot.scenes[0], id: "scene-b", order: 1, media_id: "asset-2", caption: "Second" },
      { ...snapshot.scenes[0], id: "scene-a", order: 0, media_id: "asset-1", caption: "First" }
    ]
  };
  const job = buildRenderJob(twoScenes, "preview.mp4", {
    "asset-1": { path: "/tmp/first.mp4", type: "video/mp4" },
    "asset-2": { path: "/tmp/second.mp4", type: "video/mp4" }
  }, "/tmp/job");
  assert.equal(job.clips.length, 2);
  assert.match(job.clips[0].args.join(" "), /\/tmp\/first\.mp4/);
  assert.match(job.clips[0].assContents ?? "", /First/);
  assert.match(job.clips[1].args.join(" "), /\/tmp\/second\.mp4/);
  assert.match(job.clips[1].assContents ?? "", /Second/);
  assert.match(job.listContents, new RegExp(job.clips[0].path.replaceAll(".", "\\.")));
  assert.match(job.listContents, new RegExp(job.clips[1].path.replaceAll(".", "\\.")));
});
test("render job duration is the honest per-scene sum, not first-scene-only", () => {
  const twoScenes = {
    ...snapshot,
    scenes: [
      { ...snapshot.scenes[0], id: "scene-a", order: 0, duration_ms: 700, media_id: "asset-1" },
      { ...snapshot.scenes[0], id: "scene-b", order: 1, duration_ms: 900 }
    ]
  };
  const job = buildRenderJob(twoScenes, "preview.mp4", {
    "asset-1": { path: "/tmp/first.mp4", type: "video/mp4" }
  }, "/tmp/job");
  assert.match(job.clips[0].args.join(" "), /-t 0\.7 -i \/tmp\/first\.mp4/);
  assert.match(job.clips[1].args.join(" "), /d=0\.9/);
});
test("cancellation removes partial output, rejects, and leaves no temp clips", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-cancel-"));
  const output = join(directory, "preview.mp4");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderPreview(output, snapshot, controller.signal));
  await assert.rejects(readFile(output), { code: "ENOENT" });
  assert.deepEqual(await readdir(directory), []);
});
test("worker renders the 720p accurate preview outside the API", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-render-"));
  const output = join(directory, "preview.mp4");
  await renderPreview(output, snapshot);
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
  const audio = await probeAudioStream(output);
  assert.ok(audio, "expected an audio stream on the preview");
  assert.equal(audio.codec_name, "aac");
  assert.deepEqual(await readdir(directory), ["preview.mp4"]);
});
test("renderPreview does not throw for captions with filtergraph-hostile characters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-caption-special-"));
  const output = join(directory, "preview.mp4");
  const special = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], caption: "100% {ok} [x], don't" }]
  };
  await renderPreview(output, special);
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
});
test("renderPlan cues feed multiple timed Dialogue lines with distinct, contiguous time ranges", () => {
  const multiSentence = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], caption: "First part happens now. Second part happens later.", duration_ms: 4000 }]
  };
  const plan = renderPlan(multiSentence, referenceProfile);
  const cues = plan.scenes[0].caption_cues;
  assert.ok(cues.length >= 2, "multi-sentence caption yields multiple cues");
  const ass = buildCaptionAss(cues);
  const dialogues = ass.split("\n").filter((line) => line.startsWith("Dialogue:"));
  assert.equal(dialogues.length, cues.length);
  const timeRanges = new Set(dialogues.map((line) => line.split(",").slice(1, 3).join(",")));
  assert.equal(timeRanges.size, cues.length, "each Dialogue line has a distinct time range");
  assert.match(ass, /First part happens now\./);
  assert.match(ass, /Second part happens later\./);
});
test("worker renders a preview with multiple timed caption cues burned in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-multi-cue-"));
  const output = join(directory, "preview.mp4");
  const multiSentence = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], caption: "First part happens now. Second part happens later.", duration_ms: 1500 }]
  };
  await renderPreview(output, multiSentence);
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
});
test("worker burns caption pixels into the rendered frame", async () => {
  const withCaptionDirectory = await mkdtemp(join(tmpdir(), "fengine-caption-visible-"));
  const withoutCaptionDirectory = await mkdtemp(join(tmpdir(), "fengine-caption-empty-"));
  const withCaption = join(withCaptionDirectory, "preview.mp4");
  const withoutCaption = join(withoutCaptionDirectory, "preview.mp4");
  await renderPreview(withCaption, snapshot);
  await renderPreview(withoutCaption, {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], caption: "" }]
  });
  assert.notEqual(await frameHash(withCaption), await frameHash(withoutCaption));
});
test("worker renders attached fixture media into the preview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-media-render-"));
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
test("worker concatenates every scene's media with an honest total duration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-multi-render-"));
  const output = join(directory, "preview.mp4");
  const multiScene = {
    ...snapshot,
    scenes: [
      { ...snapshot.scenes[0], id: "scene-a", order: 0, duration_ms: 500, media_id: "asset-1", caption: "First" },
      { ...snapshot.scenes[0], id: "scene-b", order: 1, duration_ms: 700, caption: "Second" }
    ]
  };
  await renderPreview(output, multiScene, undefined, {
    "asset-1": { path: join(fixtures, "scene_one.mp4"), type: "video/mp4" }
  });
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
  const probed = await probeMediaFile(output);
  assert.ok(probed.duration_ms, "expected a probeable duration");
  assert.ok(
    Math.abs(probed.duration_ms - 1200) < 200,
    `expected ~1200ms (500+700), got ${probed.duration_ms}`
  );
  const audio = await probeAudioStream(output);
  assert.ok(audio, "expected an audio stream on the concatenated preview");
  assert.equal(audio.codec_name, "aac");
  assert.deepEqual(await readdir(directory), ["preview.mp4"]);
});
test("worker renders image-only scene with a silent audio pad", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-still-render-"));
  const output = join(directory, "preview.mp4");
  const withStill = {
    ...snapshot,
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1", duration_ms: 500, caption: "" }]
  };
  await renderPreview(output, withStill, undefined, {
    "asset-1": { path: join(fixtures, "still.jpg"), type: "image/jpeg" }
  });
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
  const audio = await probeAudioStream(output);
  assert.ok(audio, "expected a silent audio pad on still-only scenes");
  assert.equal(audio.codec_name, "aac");
});
test("worker mixdown burns the soundtrack into the concat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fengine-mixdown-"));
  const bed = join(directory, "bed.wav");
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=2",
      "-c:a", "pcm_s16le", bed
    ], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
  const output = join(directory, "preview.mp4");
  const withBed = {
    ...snapshot,
    brief: {
      ...snapshot.brief,
      soundtrack: { kind: "upload", media_id: "bed", bpm: 120, offset_ms: 0, level: 1 }
    },
    scenes: [{ ...snapshot.scenes[0], media_id: "asset-1", duration_ms: 500, caption: "" }]
  };
  await renderPreview(output, withBed, undefined, {
    "asset-1": { path: join(fixtures, "still.jpg"), type: "image/jpeg" },
    bed: { path: bed, type: "audio/wav" }
  });
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  const audio = await probeAudioStream(output);
  assert.ok(audio, "expected mixed audio on the export");
  assert.equal(audio.codec_name, "aac");
});
test("worker renders zoompan motion (zoom and push) without ffmpeg errors", async () => {
  for (const motion of ["zoom", "push"]) {
    const directory = await mkdtemp(join(tmpdir(), `fengine-motion-${motion}-`));
    const output = join(directory, "preview.mp4");
    const withMotion = {
      ...snapshot,
      scenes: [{ ...snapshot.scenes[0], media_id: "asset-1", duration_ms: 500, motion }]
    };
    await renderPreview(output, withMotion, undefined, {
      "asset-1": { path: join(fixtures, "scene_one.mp4"), type: "video/mp4" }
    });
    const bytes = await readFile(output);
    assert.ok(bytes.length > 1000, `${motion} render produced output`);
    assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
  }
});
test("hosted worker can share the API database URL when QUEUE_DATABASE_URL is unset", async () => {
  const source = await readFile(new URL("../src/start.ts", import.meta.url), "utf8");
  assert.match(source, /QUEUE_DATABASE_URL\?\.trim\(\) \|\| required\("DATABASE_URL"\)/);
});

test("hosted Fly API app runs a worker process that can render", async () => {
  const fly = await readFile(new URL("../../../fly.api.toml", import.meta.url), "utf8");
  assert.match(fly, /worker = "node apps\/worker\/dist\/start\.js"/);
  assert.match(fly, /\[http_service\][\s\S]*processes = \["app"\]/);
  const docker = await readFile(new URL("../../api/Dockerfile", import.meta.url), "utf8");
  assert.match(docker, /apps\/worker\/dist/);
  assert.match(docker, /usr\/local\/bin\/ffmpeg/);
  assert.match(docker, /FFMPEG_RELEASE_TAG=autobuild-/);
  const workerDocker = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(workerDocker, /packages\/fal-host\/dist/);
  assert.equal(
    docker.match(/ARG FFMPEG_SHA256=.*/)?.[0],
    workerDocker.match(/ARG FFMPEG_SHA256=.*/)?.[0]
  );
});

test("render download trusts etag when import stored a placeholder digest", async () => {
  const source = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8");
  const start = source.indexOf("async downloadSealed");
  const end = source.indexOf("async seal(", start);
  assert.ok(start >= 0 && end > start);
  const fn = source.slice(start, end);
  assert.match(fn, /await this\.download\(/);
  assert.doesNotMatch(fn, /sealed object identity mismatch/);
});

test("worker GetObject uses If-Match and omits VersionId for R2", async () => {
  const source = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8");
  const start = source.indexOf("private async download(");
  const end = source.indexOf("async downloadSealed", start);
  assert.ok(start >= 0 && end > start);
  const fn = source.slice(start, end);
  assert.match(fn, /IfMatch: etag/);
  assert.doesNotMatch(fn, /VersionId: versionId/);
});
