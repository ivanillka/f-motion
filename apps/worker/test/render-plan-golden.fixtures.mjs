/**
 * Fixtures for the render job golden test. They are inputs only: the expected
 * FFmpeg arguments, concat list and ASS documents live in
 * `fixtures/render-plan-golden.json`, captured from the worker before it started
 * compiling render plan v1. The compile step must keep every byte of that file.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const scene = (overrides) => ({
  id: "scene-1",
  order: 0,
  caption: "Project caption",
  duration_ms: 1000,
  focal_x: 0.5,
  focal_y: 0.5,
  motion: "none",
  audio_level: 1,
  ducking: false,
  ...overrides
});

const snapshot = (overrides) => ({
  schema_version: 1,
  id: "golden",
  owner_id: "owner",
  revision: 7,
  brief: { purpose: "Demo", audience: "Teams", tone: "Warm" },
  scenes: [scene()],
  ...overrides
});

const profile = { width: 720, height: 1280, watermark: "Reference preview" };

export const goldenFixtures = [
  {
    name: "still zoom",
    snapshot: snapshot({
      scenes: [scene({ media_id: "still-1", motion: "zoom", caption: "Harbour at dawn" })]
    }),
    profile,
    media: {
      "still-1": { path: "media/still-1.jpg", type: "image/jpeg", width: 1600, height: 1200 }
    }
  },
  {
    name: "wide push strong",
    snapshot: snapshot({
      brief: { purpose: "Demo", audience: "Teams", tone: "Warm", motion_strength: "strong" },
      scenes: [scene({ media_id: "clip-1", motion: "push", caption: "Ferry pulling out", duration_ms: 2400 })]
    }),
    profile,
    media: {
      "clip-1": { path: "media/clip-1.mp4", type: "video/mp4", width: 1920, height: 1080, hasAudio: true }
    }
  },
  {
    name: "voice and stock bed",
    snapshot: snapshot({
      brief: {
        purpose: "Demo",
        audience: "Teams",
        tone: "Warm",
        soundtrack: { kind: "stock", stock_id: "pulse", bpm: 101, offset_ms: 0, level: 0.8 },
        voiceover: { media_id: "voice-1", offset_ms: 250, level: 1 }
      },
      scenes: [
        scene({ id: "scene-1", order: 0, caption: "Low tide", media_id: "clip-2", duration_ms: 1200 }),
        scene({ id: "scene-2", order: 1, caption: "Then the wind turns", media_id: "clip-2", duration_ms: 900 })
      ]
    }),
    profile,
    media: {
      "clip-2": { path: "media/clip-2.mp4", type: "video/mp4", width: 1080, height: 1920 },
      "voice-1": { path: "media/voice-1.wav", type: "audio/wav" }
    }
  },
  {
    name: "brand mark and title look",
    snapshot: snapshot({
      brief: {
        purpose: "Demo",
        audience: "Teams",
        tone: "Warm",
        brand_mark: true,
        brand_mark_size: "standard"
      },
      scenes: [scene({
        media_id: "still-2",
        title: "Harbour light",
        overlay_look: "title",
        duration_ms: 1800
      })]
    }),
    profile,
    media: {
      "still-2": { path: "media/still-2.png", type: "image/png", width: 1200, height: 1600 }
    }
  },
  {
    name: "beat snapped photo reel",
    snapshot: snapshot({
      brief: {
        purpose: "Demo",
        audience: "Teams",
        tone: "Warm",
        soundtrack: { kind: "stock", stock_id: "pulse", bpm: 101, offset_ms: 0, level: 0.8 }
      },
      scenes: [
        scene({ id: "scene-1", order: 0, caption: "Buoys", media_id: "still-1", motion: "zoom", duration_ms: 1900 }),
        scene({ id: "scene-2", order: 1, caption: "Gulls", media_id: "still-3", motion: "zoom_out", duration_ms: 1900 }),
        scene({ id: "scene-3", order: 2, caption: "Gone", media_id: "still-1", motion: "push", duration_ms: 1900 })
      ]
    }),
    profile,
    media: {
      "still-1": { path: "media/still-1.jpg", type: "image/jpeg", width: 1600, height: 1200 },
      "still-3": { path: "media/still-3.webp", type: "image/webp", width: 900, height: 1600 }
    }
  },
  {
    name: "contain fit",
    snapshot: snapshot({
      scenes: [scene({
        media_id: "still-2",
        fit: "contain",
        motion: "zoom",
        caption: "Whole frame",
        overlay_place: "top",
        duration_ms: 1500
      })]
    }),
    profile,
    media: {
      "still-2": { path: "media/still-2.png", type: "image/png", width: 1200, height: 1600 }
    }
  }
].map((fixture, index) => ({
  ...fixture,
  tempDir: `/tmp/golden-${index}`,
  outputPath: `/tmp/golden-${index}/out.mp4`
}));

export const goldenPath = join(here, "fixtures", "render-plan-golden.json");

export function readGolden() {
  return JSON.parse(readFileSync(goldenPath, "utf8"));
}

/**
 * Absolute paths are the one thing a golden file cannot pin: the brand asset
 * lives under the checkout and temp dirs under the OS temp root. Everything
 * else stays verbatim.
 */
export function normalizePaths(captured, repoRoot) {
  return JSON.parse(JSON.stringify(captured).split(repoRoot).join("<repo>"));
}

export function capturedJob(job) {
  return {
    clips: job.clips.map((clip) => ({
      path: clip.path,
      args: clip.args,
      ...(clip.assPath ? { assPath: clip.assPath } : {}),
      ...(clip.assContents ? { assContents: clip.assContents } : {})
    })),
    listPath: job.listPath,
    listContents: job.listContents,
    concatArgs: job.concatArgs
  };
}
