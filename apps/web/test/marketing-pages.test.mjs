import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("hosted marketing uses local fonts and un-redirected hero images", async () => {
  const pages = await readFile(new URL("../src/MarketingPages.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/marketing.css", import.meta.url), "utf8");
  const finish = await readFile(new URL("../scripts/finish-web-build.mjs", import.meta.url), "utf8");
  assert.match(pages, /\/marketing\/studio-ui\.webp/);
  assert.match(pages, /\/marketing\/studio-ui\.jpg/);
  assert.doesNotMatch(pages, /\/web\/assets\/studio-ui/);
  assert.doesNotMatch(css, /fonts\.googleapis\.com/);
  assert.match(css, /\/fonts\/syne-700\.woff2/);
  assert.match(finish, /\/web\/assets\/\* \/web\/assets\/:splat 200/);
  await readFile(new URL("../public/marketing/studio-ui.jpg", import.meta.url));
  await readFile(new URL("../public/fonts/syne-700.woff2", import.meta.url));
});

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
