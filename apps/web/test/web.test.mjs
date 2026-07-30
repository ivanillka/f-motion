import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("required recovery, accessibility, and preview language is present", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  for (const phrase of ["Drafts", "Create with licensed stock", "Use my own media instead", "visual-first stock search", "Video preview", "Approximate preview", "Automatically matched video", "Edit description and rematch", "Reload latest", "Save as new project", "media not copied", "Reconnecting", "magic link", "Google", "Pexels", "Cancel render", "Download video", "Final render failed", "Retry", "Settings", "Sign out", "Waiting for media inspection", "Media is still inspecting"]) assert.match(source, new RegExp(phrase));
  assert.doesNotMatch(source, /Test stale revision|Choose one concept/);
  assert.doesNotMatch(source, /Search Pexels|Use this video|Choose visuals/);
  for (const unsafe of ["fengine-access-token", "/auth/v1/otp", "/authorize", "location.hash"]) {
    assert.doesNotMatch(source, new RegExp(unsafe.replace("/", "\\/")));
  }
});
test("320px and reduced motion styles are explicit", async () => {
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /max-width: 520px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
});
