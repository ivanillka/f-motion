/**
 * Writes the shared render plan fixtures the Dart reader is tested against.
 * The plans come from the same builder the worker renders with, so a drift in
 * `buildRenderPlanV1` shows up as a diff in `packages/contracts/fixtures`
 * instead of a phone rendering something the server never sends.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderPlanV1, validateRenderPlanV1 } from "@f-engine/reel-engine";
import { goldenFixtures } from "./render-plan-golden.fixtures.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const contractsFixtures = resolve(here, "../../../packages/contracts/fixtures");

const selected = [
  { name: "beat snapped photo reel", file: "render-plan-v1-photo-reel.json" },
  { name: "brand mark and title look", file: "render-plan-v1-brand-mark.json" },
  { name: "voice and stock bed", file: "render-plan-v1-voice-and-bed.json" },
  { name: "contain fit", file: "render-plan-v1-contain.json" }
];

function kindOf(type) {
  if (type.startsWith("image/")) return "still";
  if (type.startsWith("video/")) return "video";
  return "none";
}

function descriptors(media) {
  const out = {};
  for (const [id, input] of Object.entries(media)) {
    out[id] = {
      kind: kindOf(input.type),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.hasAudio === undefined ? {} : { has_audio: input.hasAudio })
    };
  }
  return out;
}

for (const want of selected) {
  const fixture = goldenFixtures.find((item) => item.name === want.name);
  if (!fixture) throw new Error(`no golden fixture named ${want.name}`);
  const plan = validateRenderPlanV1(
    buildRenderPlanV1(fixture.snapshot, fixture.profile, descriptors(fixture.media))
  );
  const path = resolve(contractsFixtures, want.file);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  process.stdout.write(`wrote ${want.file} (${plan.scenes.length} scenes)\n`);
}
