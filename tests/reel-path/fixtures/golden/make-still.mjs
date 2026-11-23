/**
 * Draws the golden frame fixture: a calm abstract gradient with a soft sun, a
 * thin ring, and a horizon line. The committed JPEG is the source of truth;
 * this script only documents how it was made and lets a maintainer redraw it.
 *
 * FFmpeg encodes the JPEG because the worker and the test harness already need
 * FFmpeg, and a plain 720x1280 RGB PNG would cost ten times the bytes.
 *
 * Usage: node tests/reel-path/fixtures/golden/make-still.mjs
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WIDTH = 720;
const HEIGHT = 1280;
const OUT = fileURLToPath(new URL("./golden-still.jpg", import.meta.url));

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (from, to, t) => from + (to - from) * t;
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

function glow(nx, ny, cx, cy, radius, color, strength) {
  const d = Math.hypot(nx - cx, ny - cy);
  if (d >= radius) return [0, 0, 0];
  const falloff = (1 - d / radius) ** 2 * strength;
  return [color[0] * falloff, color[1] * falloff, color[2] * falloff];
}

function pixel(nx, ny) {
  const shade = smooth(ny);
  let r = mix(18, 208, shade);
  let g = mix(30, 142, shade);
  let b = mix(40, 104, shade);

  for (const [cx, cy, radius, color, strength] of [
    [0.72, 0.24, 0.3, [255, 224, 178], 0.65],
    [0.1, 0.12, 0.4, [56, 196, 190], 0.3],
    [0.15, 0.72, 0.35, [108, 92, 180], 0.25],
    [0.8, 0.9, 0.4, [255, 140, 96], 0.25]
  ]) {
    const [ar, ag, ab] = glow(nx, ny, cx, cy, radius, color, strength);
    r += ar;
    g += ag;
    b += ab;
  }

  const ringDistance = Math.abs(Math.hypot(nx - 0.5, ny - 0.46) - 0.3);
  const ring = Math.exp(-((ringDistance / 0.012) ** 2)) * 0.18;
  const horizon = Math.exp(-(((ny - 0.62) / 0.006) ** 2)) * 0.1;
  const edge = Math.hypot(nx - 0.5, ny - 0.5) / 0.72;
  const vignette = 1 - 0.16 * clamp01(edge) ** 2;

  const grain = (Math.sin(nx * 127.1 + ny * 311.7) * 0.5 + 0.5 - 0.5) * 3;
  const dim = (1 - ring - horizon) * vignette;
  return [
    Math.round(clamp01((r * dim + grain) / 255) * 255),
    Math.round(clamp01((g * dim + grain) / 255) * 255),
    Math.round(clamp01((b * dim + grain) / 255) * 255)
  ];
}

const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const [r, g, b] = pixel((x + 0.5) / WIDTH, (y + 0.5) / HEIGHT);
    const at = (y * WIDTH + x) * 3;
    raw[at] = r;
    raw[at + 1] = g;
    raw[at + 2] = b;
  }
}

const encoded = spawnSync("ffmpeg", [
  "-y",
  "-v", "error",
  "-f", "rawvideo",
  "-pix_fmt", "rgb24",
  "-s", `${WIDTH}x${HEIGHT}`,
  "-i", "-",
  "-frames:v", "1",
  "-q:v", "3",
  "-map_metadata", "-1",
  OUT
], { input: raw });

if (encoded.error || encoded.status !== 0) {
  console.error(encoded.error?.message ?? encoded.stderr?.toString() ?? "ffmpeg failed");
  process.exit(1);
}
console.log(`wrote ${OUT}`);
