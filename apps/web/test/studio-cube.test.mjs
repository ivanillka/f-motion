import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("studio cube rotates short slides then preview, bulk, progress, download", async () => {
  const cube = await readFile(new URL("../src/StudioCube.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/marketing.css", import.meta.url), "utf8");
  const site = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../src/AdminPage.tsx", import.meta.url), "utf8");
  assert.match(cube, /What to make\?/);
  assert.match(cube, /One cut/);
  assert.match(cube, /How many\?/);
  assert.match(cube, /quoteBulk/);
  assert.match(cube, /render: "final"/);
  assert.match(cube, /rotateX\(8deg\) rotateY\(\$\{yaw\}deg\)/);
  assert.match(css, /\.cube-studio \{[^}]*overflow: hidden/);
  assert.match(css, /--s: min\(90vw, calc\(\(100dvh - 5\.75rem\) \* 0\.86\), 46rem\)/);
  assert.match(css, /\.cube-studio \.mkt-cube-core \.mkt-face-title\.is-long \{[^}]*white-space: nowrap/);
  assert.match(cube, /\/studio\/edit/);
  assert.match(cube, /Create slides/);
  assert.match(site, /StudioCube/);
  assert.match(site, /isStudioEditPath/);
  assert.match(site, /AdminPage/);
  assert.match(admin, /Projects/);
  assert.match(admin, /\/studio\/edit\?project=/);
});
