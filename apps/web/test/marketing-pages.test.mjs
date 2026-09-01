import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("marketing site gates how-it-works and login as coming soon on hosted", async () => {
  const source = await readFile(new URL("../src/MarketingPages.tsx", import.meta.url), "utf8");
  assert.match(source, /How it works/);
  assert.match(source, /href="\/how-it-works"/);
  assert.match(source, /href="\/login"/);
  assert.match(source, /ComingSoon title="How it works"/);
  assert.match(source, /ComingSoon title="Login"/);
  assert.match(source, /studioComingSoon/);
});

test("site router keeps self-host on studio-only App", async () => {
  const source = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  assert.match(source, /VITE_SELFHOST_AUTH === "1"/);
  assert.match(source, /studioComingSoon/);
  assert.match(source, /MarketingSite path="\/login"/);
});
