import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("home is a centered title with feature buttons", async () => {
  const source = await readFile(new URL("../src/MarketingPages.tsx", import.meta.url), "utf8");
  assert.match(source, /mkt-splash/);
  assert.match(source, /F-Motion/);
  assert.match(source, /aria-label="Features"/);
  assert.match(source, />Studio</);
  assert.match(source, /\/how-it-works/);
  assert.match(source, /\/hosted/);
  assert.match(source, /\/self-host/);
  assert.doesNotMatch(source, /mkt-hero-media|mkt-recipes|\bComingSoon\b/);
});

test("every marketing page stays on the splash and animates the swap", async () => {
  const pages = await readFile(new URL("../src/MarketingPages.tsx", import.meta.url), "utf8");
  const site = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  assert.match(pages, /How it works/);
  assert.match(pages, /Coming soon on f-motion\.com/);
  assert.match(pages, /mkt-page is-\$\{phase\}/);
  assert.match(pages, /prefers-reduced-motion/);
  assert.match(site, /isMarketingPath/);
  assert.match(site, /history\.pushState/);
  assert.match(site, /document\.addEventListener\("click"/);
});

test("site router keeps self-host on studio-only App", async () => {
  const source = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  assert.match(source, /VITE_SELFHOST_AUTH === "1"/);
  assert.match(source, /studioComingSoon/);
  assert.match(source, /MarketingSite path="\/login"/);
});
