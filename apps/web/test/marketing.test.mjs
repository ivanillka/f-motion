import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

test("marketing routes keep honest OSS copy and no invented platform", async () => {
  const pages = new URL("../public/web/", import.meta.url);
  const leftover = [];
  for (const name of await readdir(pages)) {
    if (name.endsWith(".html")) leftover.push(await readFile(new URL(name, pages), "utf8"));
  }
  const source = [
    await readFile(new URL("../src/marketing/MarketingApp.tsx", import.meta.url), "utf8"),
    ...leftover
  ].join("\n");
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
    "Not a multitrack editor",
    "Write a short brief, pick a story, drop in your clips, download a 720p vertical preview.",
    "How a reel gets made",
    "Make a preview",
    "Read the install guide",
    "you confirm before it starts"
  ]) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const leftover of [
    "Ready to compile",
    "The Pipeline",
    "Get the image",
    "VPS paste",
    "no prices listed",
    "See integration"
  ]) {
    assert.doesNotMatch(source, new RegExp(leftover.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
