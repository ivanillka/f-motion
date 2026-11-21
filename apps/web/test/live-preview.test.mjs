import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const scene = {
  id: "scene-a",
  order: 0,
  caption: "one two three four",
  duration_ms: 4000,
  focal_x: 0.5,
  focal_y: 0.5,
  motion: "zoom",
  audio_level: 1,
  ducking: false
};

test("the live stage seeks the export's frame instead of animating toward it", async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom"
  });
  try {
    const { livePreviewFrame } = await vite.ssrLoadModule("/src/live-preview.ts");
    const start = livePreviewFrame(scene, 0);
    const middle = livePreviewFrame(scene, scene.duration_ms / 2);
    const end = livePreviewFrame(scene, scene.duration_ms);
    // Gentle is the default move: 1.00 to 1.06 on the worker's cosine ease, so
    // the middle frame is exactly halfway between the ends.
    assert.ok(Math.abs(start.zoom - 1) < 0.005, String(start.zoom));
    assert.ok(Math.abs(middle.zoom - 1.03) < 0.005, String(middle.zoom));
    assert.ok(Math.abs(end.zoom - 1.06) < 0.005, String(end.zoom));
    assert.match(start.transform, /scale\(1(\.0+)?\)/);
    assert.match(end.transform, /scale\(1\.06/);

    // A pause and a scrub read the same elapsed time, so asking twice cannot
    // drift the way a CSS animation would.
    const again = livePreviewFrame(scene, scene.duration_ms / 2);
    assert.equal(again.transform, middle.transform);
    assert.deepEqual(again.offset, middle.offset);

    // The lit word follows the same seek.
    const spokenStart = start.spoken.index;
    const spokenEnd = end.spoken.index;
    assert.equal(spokenStart, 0);
    assert.ok(spokenEnd > spokenStart, `${spokenStart} -> ${spokenEnd}`);
    assert.deepEqual(middle.spoken.words, start.spoken.words);
  } finally {
    await vite.close();
  }
});

test("the lit word follows the written take times when the stage is scrubbed", async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom"
  });
  try {
    const { livePreviewFrame } = await vite.ssrLoadModule("/src/live-preview.ts");
    // The cues narration writes for a measured take: the line ends with its audio
    // and a pause sits between the two sentences.
    const take = {
      ...scene,
      caption: "Read the full post.",
      duration_ms: 1530,
      overlay_look: "spoken",
      overlay_place: "center",
      caption_cues: [
        { text: "Read", start_ms: 0, end_ms: 240 },
        { text: "the", start_ms: 240, end_ms: 390 },
        { text: "full", start_ms: 600, end_ms: 900 },
        { text: "post.", start_ms: 900, end_ms: 1410 }
      ]
    };
    const at = (ms) => livePreviewFrame(take, ms);
    assert.deepEqual(at(0).spoken.words, take.caption_cues);
    assert.equal(at(0).spoken.index, 0);
    assert.equal(at(300).spoken.index, 1);
    // Scrubbing into the pause holds the finished word instead of rewinding.
    assert.equal(at(500).spoken.index, 1);
    assert.equal(at(700).spoken.index, 2);
    assert.equal(at(1200).spoken.index, 3);
    // The tail after the last word still reads as the last word, not silence.
    assert.equal(at(take.duration_ms).spoken.index, 3);
  } finally {
    await vite.close();
  }
});

test("a pan reports the worker's pan sign as a CSS translate", async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom"
  });
  try {
    const { livePreviewFrame } = await vite.ssrLoadModule("/src/live-preview.ts");
    const pan = livePreviewFrame({ ...scene, motion: "push" }, 0, {}, { width: 1080, height: 1920 }, { width: 1080, height: 1920 });
    const later = livePreviewFrame({ ...scene, motion: "push" }, scene.duration_ms, {}, { width: 1080, height: 1920 }, { width: 1080, height: 1920 });
    // The worker's pan starts at the top edge of the overscan and walks down, so
    // the picture starts above the frame and ends below it.
    assert.ok(pan.offset.y < 0, String(pan.offset.y));
    assert.ok(later.offset.y > 0, String(later.offset.y));
    assert.ok(Math.abs(pan.offset.y + later.offset.y) < 1e-9);
    // A window at the top edge shows the picture's top, so the picture itself
    // starts below the frame centre and ends above it.
    assert.match(pan.transform, /translate3d\(0%, 3%, 0\) scale\(1\.06/);
    assert.match(later.transform, /translate3d\(0%, -3%, 0\) scale\(1\.06/);
    assert.ok(Math.abs(pan.zoom - 1.06) < 1e-9);
  } finally {
    await vite.close();
  }
});
