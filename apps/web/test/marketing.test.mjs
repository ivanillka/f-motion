import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("marketing routes keep honest OSS copy and no invented platform", async () => {
  const source = await readFile(new URL("../src/marketing/MarketingApp.tsx", import.meta.url), "utf8");
  for (const phrase of [
    "F-MOTION",
    "Vertical reels from your own media",
    "Open studio",
    "Self-host",
    "brief → storyboard → preview",
    "/studio",
    "/self-host",
    "/hosted",
    "One image on your VPS",
    "Apache-2.0",
    "Pexels is not public domain",
    "Not a multitrack editor"
  ]) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const forbidden of [
    "MCP",
    "mcp",
    "webhook",
    "api.f-motion.io",
    "ALL RIGHTS RESERVED",
    "zero-trust",
    "masters never leave",
    "Fotium",
    "4K",
    "60 FPS",
    "NLE",
    "multitrack editing",
    "See integration",
    "Embed cinematic creation",
    "project-imports"
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
