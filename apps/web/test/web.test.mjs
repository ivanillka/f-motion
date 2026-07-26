import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("required recovery, accessibility, and preview language is present", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  for (const phrase of ["Approximate preview", "Reload latest", "Save as new project", "Reconnecting", "magic link", "Google", "Pexels", "Cancel render", "Download preview"]) assert.match(source, new RegExp(phrase));
});
test("320px and reduced motion styles are explicit", async () => {
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /max-width: 520px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});
