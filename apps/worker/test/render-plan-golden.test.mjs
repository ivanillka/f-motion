/**
 * Byte-for-byte guard on the render job. The expected file was captured from
 * the worker while it still built FFmpeg arguments straight from the snapshot.
 * Adding render plan v1 must not move a single argument, ASS line or concat
 * entry, so this test compares the whole job, not selected substrings.
 *
 * Regenerate only when a rendering change is intended:
 *   node apps/worker/test/render-plan-golden.record.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderJob } from "../dist/index.js";
import { capturedJob, goldenFixtures, normalizePaths, readGolden } from "./render-plan-golden.fixtures.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const golden = readGolden();

test("the golden file covers every render path this spike touches", () => {
  assert.deepEqual(
    golden.jobs.map((job) => job.name),
    goldenFixtures.map((fixture) => fixture.name)
  );
});

for (const fixture of goldenFixtures) {
  test(`render job stays byte identical: ${fixture.name}`, () => {
    const job = buildRenderJob(fixture.snapshot, fixture.outputPath, fixture.media, fixture.tempDir, fixture.profile);
    const captured = normalizePaths(capturedJob(job), repoRoot);
    assert.deepEqual(captured, golden.jobs.find((entry) => entry.name === fixture.name).job);
  });
}
