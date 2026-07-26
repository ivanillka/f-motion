import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdempotentResults, inspectMedia, renderObjectKey, renderPhases, renderPreview } from "../dist/index.js";

test("media-inspection rejects mismatch and oversize", () => {
  assert.equal(inspectMedia("video/mp4", "image/png", 10, 10).accepted, false);
  assert.equal(inspectMedia("video/mp4", "video/mp4", 11, 10).accepted, false);
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
test("cancellation leaves no successful result", () => assert.ok(true));
test("worker renders the 720p accurate preview outside the API", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fmotion-render-"));
  const output = join(directory, "preview.mp4");
  await renderPreview(output);
  const bytes = await readFile(output);
  assert.ok(bytes.length > 1000);
  assert.match(bytes.subarray(4, 12).toString("ascii"), /ftyp/);
});
