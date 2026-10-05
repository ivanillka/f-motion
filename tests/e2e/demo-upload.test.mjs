import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("demo signed uploads go to the local worker sink", async () => {
  const harness = await readFile(new URL("./run-servers.mjs", import.meta.url), "utf8");
  const worker = await readFile(new URL("./worker-server.mjs", import.meta.url), "utf8");
  assert.match(harness, /127\.0\.0\.1:43141\/uploads\//);
  assert.doesNotMatch(harness, /e2e-storage\.invalid/);
  assert.match(worker, /request\.url\?\.startsWith\("\/uploads\/"\)/);
  assert.match(worker, /access-control-allow-origin/);
});
