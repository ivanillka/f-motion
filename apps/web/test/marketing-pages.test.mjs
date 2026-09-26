import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

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
  assert.match(css, /--s: min\(62vw, 22rem\)/);
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
  assert.match(source, /href="\/integrate.html"/);
  assert.match(source, />GitHub</);
  assert.match(source, /skills\/fmotion/);
  assert.match(source, /\/self-host/);
  assert.match(repo, /ivanillka\/f-motion/);
  assert.match(repo, /advisor\/133-design-contract/);
  assert.doesNotMatch(source, />Hosted</);
  assert.doesNotMatch(source, /href="\/hosted"/);
  assert.doesNotMatch(source, /mkt-hero-media|mkt-recipes|\bComingSoon\b/);
});

test("hosted splash is the static marketing site, not the cube", async () => {
  const site = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  const home = await readFile(new URL("../public/web/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(site, /MarketingSite/);
  assert.doesNotMatch(site, /isMarketingPath/);
  assert.doesNotMatch(site, /mkt-cube/);
  assert.match(site, /lazy\(\(\) => import\("\.\/main"\)/);
  assert.match(home, /Turn stills and clips into motion for studio and Fotium reels/);
  assert.doesNotMatch(home, /href="\/app\/"/);
  assert.doesNotMatch(home, /href="\/login"/);
  assert.match(home, /href="\/cs\/"/);
});

test("soft-launch home shows approved English and Czech copy", async () => {
  const home = await readFile(new URL("../public/web/index.html", import.meta.url), "utf8");
  const cs = await readFile(new URL("../public/web/cs/index.html", import.meta.url), "utf8");
  const en = [
    "Turn stills and clips into motion for studio and Fotium reels.",
    "View on GitHub",
    "https://github.com/ivanillka/f-motion",
    "Open Studio",
    ">Soon<",
    "1. Import.",
    "Bring in stills, clips, or a partner feed.",
    "2. Compose.",
    "Order beats, timing, and look in the studio.",
    "3. Render.",
    "Export a reel ready for Fotium or your own host.",
    "F-Motion is the motion layer next to Fotium. Studio UI, partner import, reel engine. Self-host when you want the pipeline on your own stack.",
    "Atelier, sitting room, still life, mist.",
    "Architecture and design contract on GitHub",
    "Built for Prague studio workflows and Fotium Make-reel",
    "f-motion.com",
    "github.com/ivanillka/f-motion"
  ];
  const czech = [
    "Proměň fotky a klipy v motion pro studio i Fotium reels.",
    ">GitHub<",
    "Otevřít Studio",
    ">Brzy<",
    "Jak to funguje",
    "Fotky, klipy, partner feed.",
    "2. Skladba.",
    "Rytmus, timing, look.",
    "Reel pro Fotium nebo vlastní host.",
    "motion vrstva vedle Fotium. Studio, partner import, reel engine. Self-host když chceš pipeline u sebe.",
    "Ateliér, obývák, zátiší, mlha.",
    "Pro pražské studio workflow a Fotium Make-reel"
  ];
  for (const phrase of en) assert.match(home, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const phrase of czech) assert.match(cs, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(cs, /href="https:\/\/github\.com\/ivanillka\/f-motion"/);
  assert.match(cs, /href="\/"/);
  assert.doesNotMatch(home, /href="\/app\/"|href="\/login"/);
  assert.doesNotMatch(cs, /href="\/app\/"|href="\/login"/);
  assert.match(home, /<video id="demo-reel" autoplay muted loop playsinline preload="metadata"/);
  assert.match(cs, /<video id="demo-reel" autoplay muted loop playsinline preload="metadata"/);
  assert.match(home, /aria-label="Studio photographs rendered as a vertical reel"/);
  assert.match(cs, /aria-label="Studiové fotky vykreslené jako vertikální reel"/);
  const homeWebm = home.indexOf("demo-reel.webm");
  const homeMp4 = home.indexOf("demo-reel.mp4");
  assert.ok(homeWebm > 0 && homeMp4 > homeWebm);
  const csWebm = cs.indexOf("demo-reel.webm");
  const csMp4 = cs.indexOf("demo-reel.mp4");
  assert.ok(csWebm > 0 && csMp4 > csWebm);
  assert.doesNotMatch(home, /\u2014|\u2013|---/);
  assert.doesNotMatch(cs, /\u2014|\u2013|---/);
});

test("soft-launch hero wordmark is the inline flow loop and the cube has no text", async () => {
  const css = await readFile(new URL("../public/web/web.css", import.meta.url), "utf8");
  const markRule = css.match(/\.launch-mark \{[^}]+\}/);
  assert.ok(markRule);
  assert.match(markRule[0], /width:\s*262px/);
  assert.match(markRule[0], /max-width:\s*100%/);
  assert.match(markRule[0], /aspect-ratio:\s*4566\s*\/\s*775/);
  assert.ok(262 * 775 / 4566 > 32, "hero trail mark must stay above the 32px blur floor");
  assert.doesNotMatch(markRule[0], /translateZ|launch-hyphen/);
  assert.doesNotMatch(css, /\.launch-hyphen/);
  const flowStart = css.indexOf(".fmt-flo .fmt-flo-el");
  const flow = css.slice(flowStart, css.indexOf(".launch-sub {", flowStart));
  assert.ok(flow.length > 0);
  for (const step of ["s0", "s1", "s2", "s3"]) {
    assert.match(flow, new RegExp(`fmt-flo-flow-${step} 2800ms linear 0ms infinite`));
    assert.match(flow, new RegExp(`@keyframes fmt-flo-flow-${step}`));
  }
  assert.match(flow, /@media \(prefers-reduced-motion: reduce\) \{ \.fmt-flo \.fmt-flo-el \{ animation: none !important; \} \}/);
  assert.doesNotMatch(flow, /\b(left|top|width|height|margin|filter|box-shadow)\s*:/);
  for (const rel of ["../public/web/index.html", "../public/web/cs/index.html"]) {
    const html = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.match(html, /<h1 id="launch-title" class="launch-mark">/);
    assert.match(html, /<span class="launch-visually-hidden">F-Motion<\/span>/);
    assert.match(html, /<svg class="launch-wordmark fmt-flo" aria-hidden="true" width="262" height="44\.46" viewBox="0 -711 4566 775">/);
    assert.match(html, /<title><\/title>/);
    assert.match(html, /class="fmt-flo-el fmt-flo-f" fill="#f1f2f3"/);
    assert.match(html, /class="fmt-flo-el fmt-flo-bar" fill="#d989a0" d="M807 -711h84v775h-84z"/);
    assert.match(html, /class="fmt-flo-el fmt-flo-s1" fill="#d989a0" opacity="0\.5"/);
    assert.match(html, /class="fmt-flo-el fmt-flo-s0" fill="#d989a0" opacity="0"/);
    assert.doesNotMatch(html, /<style[\s>]/);
    assert.doesNotMatch(html, /M725 -711h84v775h-84z/);
    assert.doesNotMatch(html, /fill="#111213"|fill="#a54d67"/);
    assert.doesNotMatch(html, /<svg[^>]*\sstyle=/);
    assert.match(html, /rel="icon" href="\/icon\.svg"/);
    const scene = html.match(/<div class="launch-scene"[^>]*>[\s\S]*?<\/div>\s*<\/div>/);
    assert.ok(scene, rel);
    assert.equal(scene[0].replace(/<[^>]+>/g, "").trim(), "");
    assert.doesNotMatch(scene[0], /launch-mark|launch-hyphen|F-Motion/);
  }
});

test("every marketing page stays on the splash and animates the swap", async () => {
  const pages = await readFile(new URL("../src/MarketingPages.tsx", import.meta.url), "utf8");
  assert.match(pages, /How it works/);
  assert.match(pages, /Coming soon on f-motion\.com/);
  assert.match(pages, /SECTIONS/);
  assert.match(pages, /sectionAtWall/);
  assert.match(pages, /goFace/);
  assert.match(pages, /ArrowRight/);
  assert.match(pages, /prefers-reduced-motion/);
});

test("hosted studio opens unless VITE_STUDIO_COMING_SOON is set", async () => {
  const site = await readFile(new URL("../src/site.tsx", import.meta.url), "utf8");
  assert.match(site, /VITE_STUDIO_COMING_SOON === "1"/);
  assert.match(site, /Coming soon on f-motion\.com/);
  assert.doesNotMatch(site, /MarketingSite/);
});

test("landing demo reel stays in the 9:16 frame and respects reduced motion", async () => {
  const css = await readFile(new URL("../public/web/web.css", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/web/demo-reel.js", import.meta.url), "utf8");
  assert.match(css, /\.launch-frame \{[^}]*width:\s*260px/);
  assert.match(css, /\.launch-frame \{[^}]*aspect-ratio:\s*9\s*\/\s*16/);
  assert.match(css, /\.launch-frame \{[^}]*max-width:\s*100%/);
  assert.match(css, /@media \(min-width:\s*401px\) \{\s*\.launch-frame \{ width: 220px; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.launch-frame video \{ display: none; \}\s*\.launch-still \{ display: block; \}/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(script, /removeAttribute\("autoplay"\)/);
  assert.match(script, /\.pause\(\)/);
  const home = await readFile(new URL("../public/web/index.html", import.meta.url), "utf8");
  const cs = await readFile(new URL("../public/web/cs/index.html", import.meta.url), "utf8");
  assert.match(home, /poster="\.\/assets\/demo-reel\.webp"/);
  assert.match(cs, /poster="\.\.\/assets\/demo-reel\.webp"/);
  assert.match(home, /<source srcset="\.\/assets\/demo-reel\.webp" type="image\/webp">/);
  assert.match(home, /<img src="\.\/assets\/demo-reel\.jpg"/);
  let videoBytes = 0;
  for (const name of ["demo-reel.mp4", "demo-reel.webm"]) {
    videoBytes += (await stat(new URL(`../public/web/assets/${name}`, import.meta.url))).size;
  }
  assert.ok(videoBytes < 1.2 * 1024 * 1024, `demo reel video is ${videoBytes} bytes`);
  const webp = (await stat(new URL("../public/web/assets/demo-reel.webp", import.meta.url))).size;
  const jpg = (await stat(new URL("../public/web/assets/demo-reel.jpg", import.meta.url))).size;
  assert.ok(webp > 0 && webp < 48000, `webp poster is ${webp} bytes`);
  assert.ok(jpg > 0 && jpg < 80 * 1024, `jpg poster is ${jpg} bytes`);
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
  assert.match(source, /lazy\(\(\) => import\("\.\/main"\)/);
  assert.doesNotMatch(source, /import \{ App \} from "\.\/main"/);
  assert.doesNotMatch(source, /MarketingSite/);
});
