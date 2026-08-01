import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyPagesArtifact } from "./verify-pages-artifact.mjs";

async function fixture({ includeFunction = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "f-motion-pages-artifact-"));
  await mkdir(join(root, "apps/web/dist"), { recursive: true });
  await writeFile(join(root, "apps/web/dist/index.html"), "<!doctype html>");
  if (includeFunction) {
    await mkdir(join(root, "apps/web/functions/api"), { recursive: true });
    await writeFile(join(root, "apps/web/functions/api/[[path]].js"), "export function onRequest() {}\n");
  }
  return root;
}

test("accepts a built site with an onRequest Pages Function", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = await verifyPagesArtifact(root);

  assert.equal(result.indexPath, join(root, "apps/web/dist/index.html"));
});

test("fails when the Pages Function is missing from the source tree", async (t) => {
  const root = await fixture({ includeFunction: false });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(verifyPagesArtifact(root), /Missing Pages API Function/);
});

test("fails when the Pages Function does not export onRequest", async (t) => {
  const root = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "apps/web/functions/api/[[path]].js"), "function onRequest() {}\n");

  await assert.rejects(verifyPagesArtifact(root), /does not export onRequest/);
});
