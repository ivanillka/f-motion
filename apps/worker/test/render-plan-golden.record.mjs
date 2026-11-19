/**
 * Recaptures `fixtures/render-plan-golden.json` from the current build. Run it
 * only when the rendering change is intended and reviewed: the diff in that
 * JSON is the exact diff in what FFmpeg is asked to do.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderJob } from "../dist/index.js";
import { capturedJob, goldenFixtures, goldenPath, normalizePaths } from "./render-plan-golden.fixtures.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const jobs = goldenFixtures.map((fixture) => ({
  name: fixture.name,
  job: normalizePaths(
    capturedJob(buildRenderJob(fixture.snapshot, fixture.outputPath, fixture.media, fixture.tempDir, fixture.profile)),
    repoRoot
  )
}));
writeFileSync(goldenPath, `${JSON.stringify({ jobs }, null, 2)}\n`, "utf8");
process.stdout.write(`wrote ${jobs.length} jobs to ${goldenPath}\n`);
