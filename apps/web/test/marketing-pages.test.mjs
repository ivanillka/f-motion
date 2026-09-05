import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("home is a centered title with feature buttons", async () => {
  const source = await readFile(new URL("../src/MarketingPages.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/marketing.css", import.meta.url), "utf8");
  const repo = await readFile(new URL("../src/repo.ts", import.meta.url), "utf8");
  assert.match(source, /mkt-splash/);
  assert.match(source, /mkt-hyphen/);
  assert.match(source, /is-studio/);
  assert.match(source, /mkt-cube/);
  assert.match(source, /mkt-cube-shell/);
  assert.match(source, /mkt-cube-rig/);
  assert.match(source, /rotateY\(\$\{yaw\}deg\)/);
  assert.match(source, /is-facing/);
  assert.match(source, /is-away/);
  assert.match(source, /SECTIONS/);
  assert.match(source, /sectionAtWall/);
  assert.match(source, /stepDelta/);
  assert.match(source, /raw > n \/ 2 \? raw - n : raw/);
  assert.match(source, /WordCube/);
  assert.match(source, /setTimeout\(\(\) => setFacing\(page\), 420\)/);
  assert.match(source, /setTimeout\(\(\) => setTurning\(false\), 420\)/);
  assert.match(css, /mktEdgeGlint/);
  assert.match(css, /perspective: 42rem/);
  assert.match(css, /\.mkt-cube-rig/);
  assert.match(css, /transition: transform 0\.38s/);
  assert.doesNotMatch(css, /fonts\.googleapis/);
  assert.match(css, /mktCubeDrift/);
  assert.match(css, /\.mkt-cube-core\.is-away/);
  assert.match(css, /position: fixed/);
  assert.match(css, /padding-bottom: 8\.75rem/);
  assert.doesNotMatch(css, /rotateY\(20deg\)/);
  assert.match(source, /--mkt-pace/);
  assert.match(source, /readyState/);
  assert.match(source, /paceRef/);
  assert.match(source, /seedStars/);
  assert.match(source, /0\.34/);
  assert.match(source, /0\.66/);
  assert.doesNotMatch(source, /mkt-splash-brand/);
  assert.doesNotMatch(css, /mkt-splash-brand/);
  assert.match(css, /\.mkt-splash-lede \{/);
  assert.doesNotMatch(source, /mkt-cube-home/);
  assert.match(source, /F-Motion/);
  assert.match(source, /aria-label="Features"/);
  assert.match(source, /"Home"/);
  assert.match(source, /"Studio"/);
  assert.match(source, /\/how-it-works/);
  assert.match(source, />GitHub</);
  assert.match(source, /skills\/fmotion/);
  assert.match(source, /\/self-host/);
  assert.match(repo, /ivanillka\/f-motion/);
  assert.match(repo, /advisor\/133-design-contract/);
  assert.doesNotMatch(source, />Hosted</);
  assert.doesNotMatch(source, /href="\/hosted"/);
  assert.doesNotMatch(source, /mkt-hero-media|mkt-recipes|\bComingSoon\b/);
});

test("every marketing page stays on the splash and animates the swap", async () => {
  const pages = await readFile(new URL("../src/MarketingPages.tsx", import.meta.url), "utf8");
  const site = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  assert.match(pages, /How it works/);
  assert.match(pages, /Coming soon on f-motion\.com/);
  assert.match(pages, /SECTIONS/);
  assert.match(pages, /sectionAtWall/);
  assert.match(pages, /goFace/);
  assert.match(pages, /ArrowRight/);
  assert.match(pages, /prefers-reduced-motion/);
  assert.match(site, /isMarketingPath/);
  assert.match(site, /history\.pushState/);
  assert.match(site, /document\.addEventListener\("click"/);
  assert.match(site, /path === "\/hosted" \? "\/"/);
});

test("cube path walks the short way around a ring of any length", () => {
  const wrap = (index, n) => ((index % n) + n) % n;
  const stepDelta = (from, to, n) => {
    const raw = wrap(to - from, n);
    if (raw === 0) return 0;
    return raw > n / 2 ? raw - n : raw;
  };
  assert.equal(stepDelta(0, 1, 4), 1);
  assert.equal(stepDelta(0, 3, 4), -1);
  assert.equal(stepDelta(0, 2, 4), 2);
  assert.equal(stepDelta(0, 3, 8), 3);
  assert.equal(stepDelta(0, 5, 8), -3);
  assert.equal(wrap(-1, 5), 4);
});

test("site router keeps self-host on studio-only App", async () => {
  const source = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  assert.match(source, /VITE_SELFHOST_AUTH === "1"/);
  assert.match(source, /studioComingSoon/);
  assert.match(source, /MarketingSite path="\/login"/);
  assert.match(source, /lazy\(\(\) => import\("\.\/main"\)/);
  assert.doesNotMatch(source, /import \{ App \} from "\.\/main"/);
});
