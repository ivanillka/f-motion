import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("marketing landing keeps Web and Integrate paths with studio CTA", async () => {
  const source = await readFile(new URL("../src/MarketingLanding.tsx", import.meta.url), "utf8");
  for (const phrase of [
    "F-MOTION",
    "Vertical reels from your own media",
    "Open studio",
    "See integration",
    "Embed cinematic creation",
    "Import &amp; open",
    "Render pipeline",
    "MCP agent loop",
    "project-imports",
    "/marketing/hero-reel.png"
  ]) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});
