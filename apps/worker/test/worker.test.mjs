import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPlan } from "@f-motion/reel-engine";
import {
  IdempotentResults,
  buildCaptionAss,
  buildRenderJob,
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
test("render job builds one deterministic-plan clip per scene", () => {
  const job = buildRenderJob(snapshot, "preview.mp4", {}, "/tmp/job");
  assert.equal(job.clips.length, 1);
  const args = job.clips[0].args.join(" ");
  assert.match(args, /720x1280/);
  assert.match(args, /color=c=#202027/);
  assert.match(args, /subtitles=/);
  assert.match(job.clips[0].assContents ?? "", /Project caption/);
  const concat = job.concatArgs.join(" ");
  assert.match(concat, /F-Motion preview/);
  assert.match(concat, /project project revision 3/);
});
test("render job omits subtitles when caption is empty", () => {
  const noCaption = { ...snapshot, scenes: [{ ...snapshot.scenes[0], caption: "" }] };
  const job = buildRenderJob(noCaption, "preview.mp4", {}, "/tmp/job");
  assert.doesNotMatch(job.clips[0].args.join(" "), /subtitles=/);
  assert.equal(job.clips[0].assPath, undefined);
  assert.match(job.concatArgs.join(" "), /F-Motion preview/, "watermark-only path unchanged");
});
test("caption ass builder freezes the safe-area layout", () => {
  const ass = buildCaptionAss([{ text: "Project caption", start_ms: 0, end_ms: 500 }]);
  assert.match(ass, /PlayResX: 720/);
  assert.match(ass, /PlayResY: 1280/);
  assert.match(ass, /,40,40,140,1$/m, "40px side inset, 140px bottom margin clears the watermark band");
  assert.match(ass, /&H40000000/, "panel BackColour alpha 0x40 is ~75% opaque, above the 0.55 floor");
  assert.match(ass, /^Dialogue: 0,0:00:00\.00,0:00:00\.50,Caption,,0,0,0,,Project caption$/m);
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
  assert.doesNotMatch(args, /color=c=#202027/);
  assert.match(args, /force_original_aspect_ratio=increase/);
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
  const directory = await mkdtemp(join(tmpdir(), "fmotion-cancel-"));
  const output = join(directory, "preview.mp4");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderPreview(output, snapshot, controller.signal));
  await assert.rejects(readFile(output), { code: "ENOENT" });
  assert.deepEqual(await readdir(directory), []);
});
test("worker renders the 720p accurate preview outside the API", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-render-"));
  const output = join(directory, "preview.mp4");
  await renderPreview(output, snapshot);
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
  assert.deepEqual(await readdir(directory), ["preview.mp4"]);
});
test("renderPreview does not throw for captions with filtergraph-hostile characters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-caption-special-"));
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
  const plan = renderPlan(multiSentence);
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
  const directory = await mkdtemp(join(tmpdir(), "fmotion-multi-cue-"));
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
test("worker concatenates every scene's media with an honest total duration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-multi-render-"));
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
  assert.deepEqual(await readdir(directory), ["preview.mp4"]);
});
