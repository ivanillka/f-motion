/**
 * Records the compiled render job for the shared plan fixtures. The Dart
 * compiler in `apps/mobile/lib/render/compile.dart` is tested against these
 * files, so a change in the worker's FFmpeg arguments shows up as a golden diff
 * instead of a phone quietly rendering a different reel.
 *
 * The asset map is deliberately fake and fixed: the parity question is "same
 * plan, same arguments", not "does this machine have the files".
 *
 * Run from `apps/worker` after `npm run build`, whenever `compile-plan.ts`
 * changed on purpose:
 *   node test/render-plan-compile.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRenderPlan } from "../dist/compile-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const contractsFixtures = resolve(here, "../../../packages/contracts/fixtures");
const goldenDir = resolve(contractsFixtures, "compile");

const tempDir = "/render/tmp";
const outputPath = "/render/out/reel.mp4";
const fontsDir = "/render/assets/fonts";
const brandMark = "/render/assets/brand/f-motion-mark.webm";

/** Opaque plan ref -> stable local path, so the golden survives a file move. */
function mediaPath(ref) {
  const slug = ref.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `/render/assets/media/${slug}.bin`;
}

const plans = [
  "render-plan-v1-photo-reel.json",
  "render-plan-v1-brand-mark.json",
  "render-plan-v1-voice-and-bed.json",
  "render-plan-v1-contain.json"
];

mkdirSync(goldenDir, { recursive: true });

for (const file of plans) {
  const plan = JSON.parse(readFileSync(resolve(contractsFixtures, file), "utf8"));
  const media = {};
  for (const scene of plan.scenes) {
    if (scene.media.kind === "none") continue;
    media[scene.media.ref] = mediaPath(scene.media.ref);
  }
  if (plan.audio.bed) media[plan.audio.bed.ref] = mediaPath(plan.audio.bed.ref);
  if (plan.audio.voice) media[plan.audio.voice.ref] = mediaPath(plan.audio.voice.ref);
  const metadata = {
    comment: `comment=project fixture revision 7`,
    ...(plan.audio.bed
      ? {
        soundtrack: [
          "-metadata",
          "title=Fixture Bed",
          "-metadata",
          "artist=Fixture Artist",
          "-metadata",
          "copyright=Fixture credit"
        ]
      }
      : {})
  };
  const assets = { media, brandMark, fontsDir };
  const job = compileRenderPlan(plan, assets, {
    tempDir,
    outputPath,
    metadata
  });
  const captured = {
    plan: file,
    tempDir,
    outputPath,
    fontsDir,
    brandMark,
    media,
    metadata,
    job: {
      listPath: job.listPath,
      listContents: job.listContents,
      clips: job.clips.map((clip) => ({
        path: clip.path,
        ...(clip.assPath ? { assPath: clip.assPath } : {}),
        ...(clip.assContents ? { assContents: clip.assContents } : {}),
        args: clip.args
      })),
      concatArgs: job.concatArgs
    }
  };
  const target = resolve(goldenDir, file);
  writeFileSync(target, `${JSON.stringify(captured, null, 2)}\n`, "utf8");
  process.stdout.write(
    `wrote compile/${file} (${job.clips.length} clips, ${job.concatArgs.length} concat args)\n`
  );
}
