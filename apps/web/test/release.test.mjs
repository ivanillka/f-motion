import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APP_VERSION, RELEASE_NOTES } from "../src/release.ts";

test("app version matches package.json and CHANGELOG", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  const changelog = await readFile(new URL("../../../CHANGELOG.md", import.meta.url), "utf8");
  assert.equal(APP_VERSION, pkg.version);
  assert.equal(RELEASE_NOTES[0]?.version, APP_VERSION);
  assert.match(changelog, new RegExp(`## \\[${APP_VERSION.replace(/\./g, "\\.")}\\]`));
  for (const item of RELEASE_NOTES[0]?.items ?? []) {
    assert.match(changelog, new RegExp(item.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
