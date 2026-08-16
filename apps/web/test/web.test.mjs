import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("required recovery, accessibility, and preview language is present", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  for (const phrase of ["Drafts", "Continue to video plan", "Plan the video", "prepared this recommendation from your conversation", "Edit recommended video plan", "Recommended video plan", "What should this video achieve", "Who is it for", "How should the story unfold", "What tone fits best", "How fast should it feel", "Target length", "Where should visuals come from", "Pexels real stock video", "Continue to story concepts", "Choose a story approach", "Licensed visuals are matched only after you choose", "Storyboard", "Approximate composition", "Find licensed media", "Find another licensed video", "Generate AI image for scene", "Animate this image", "Generate one 6-second video", "Use video for scene", "Keep image", "Generate one image", "Get FAL price", "Use for scene", "Keep current media", "Generate another", "AI-generated with FAL", "Charged directly to your FAL account", "Select for scene", "Move scene", "Add scene", "Remove scene", "Generate accurate preview", "Export final", "Final export", "Download export", "playsInline", "Older preview", "Reload latest", "Save as new project", "media not copied", "pending", "was not merged", "Reconnecting", "magic link", "Google", "Pexels", "Cancel render", "Download preview", "Accurate preview failed", "Retry", "Choose video sources", "Choose your video sources", "Real stock video", "AI stills", "More providers", "More ways to create", "Locked", "Why is this locked", "Pexels stock is locked", "Connect your Pexels API key to search real stock video", "FAL generation is locked", "Open provider settings", "Settings", "Sign out", "Waiting for media inspection", "Media is still inspecting", "Connect your own Pexels API key", "F-Motion does not supply or share a Pexels key", "Connect Pexels", "Test Pexels", "Disconnect Pexels", "Connect your own FAL API-scope key", "charged directly to your FAL account", "F-Motion does not supply or share a FAL key", "Connect FAL", "Test connection", "Disconnect", "Sign in to open the imported draft from Fotium."]) assert.match(source, new RegExp(phrase));
  assert.match(source, /activeSceneId/);
  assert.match(source, /openConflict\(/);
  assert.match(source, /intendedSceneId/);
  assert.match(source, /find\(\(\{ id \}\) => id === activeSceneId\)/);
  assert.match(source, /find\(\(\{ id \}\) => id === sceneId\)/);
  assert.doesNotMatch(source, /saveScenePatch[\s\S]{0,120}scenes\[0\]/);
  assert.doesNotMatch(source, /searchStock[\s\S]{0,120}scenes\[0\]/);
  assert.doesNotMatch(source, /selectStock[\s\S]{0,120}scenes\[0\]/);
  assert.doesNotMatch(source, /Test stale revision|Choose one concept/);
  assert.doesNotMatch(source, /Automatically matched|strongest licensed match|Finding the best/);
  assert.doesNotMatch(source, /concept_id:\s*"direct"/);
  assert.match(source, /chooseConcept\(/);
  assert.match(source, /aria-label=\{\`Choose \$\{concept\.title\} concept\`\}/);
  assert.match(source, /requestRender\("final"\)/);
  assert.match(source, /kind: "final"|JSON\.stringify\(\{ kind \}\)/);
  for (const unsafe of ["fengine-access-token", "/auth/v1/otp", "/authorize", "location.hash"]) {
    assert.doesNotMatch(source, new RegExp(unsafe.replace("/", "\\/")));
  }
  // BYOK: never persist provider API keys or expose them via Vite env.
  // Job-id resume keys (falJobStorageKey) are allowed; credentials are not.
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.[^\n]*\bfalKey\b/);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.[^\n]*["'`][^"'`]*FAL_KEY/);
  assert.doesNotMatch(source, /VITE_.*FAL/);
  assert.match(source, /falJobStorageKey/);
  assert.match(source, /openFalGenerate\(/);
  assert.match(source, /confirmFalImage\(/);
  assert.match(source, /useFalGeneratedMedia\(/);
  assert.match(source, /openFalAnimate\(/);
  assert.match(source, /confirmFalVideo\(/);
  assert.doesNotMatch(source, /useFalGeneratedMedia[\s\S]{0,80}pollFalGeneration/);
  assert.doesNotMatch(source, /Generation is not live yet/);

  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.[^\n]*\bpexelsKey\b/);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.[^\n]*["'`][^"'`]*PEXELS/);
  assert.doesNotMatch(source, /VITE_.*PEXELS/);
});

test("draft media hydration replaces project-scoped stock, upload, reopen, and failure state", async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom"
  });
  try {
    const { loadSceneMediaViews } = await vite.ssrLoadModule("/src/api.ts");
    const project = (id, mediaId) => ({
      id,
      revision: 1,
      brief: { purpose: id, audience: "Viewers", tone: "Warm" },
      scenes: [{ id: `scene-${id}`, media_id: mediaId }]
    });
    const views = {
      a: { id: "a", state: "ready", attribution: { source: "Pexels", creator: "Creator A", attributionUrl: "https://www.pexels.com/a", previewUrl: "https://images.pexels.com/a.jpg" } },
      b: { id: "b", state: "ready", attribution: { source: "Pexels", creator: "Creator B", attributionUrl: "https://www.pexels.com/b", previewUrl: "https://images.pexels.com/b.jpg" } },
      upload: { id: "upload", state: "ready" }
    };
    const api = { request: async (path) => views[path.split("/").at(-1)] };

    const first = await loadSceneMediaViews(api, project("one", "a"));
    const second = await loadSceneMediaViews(api, project("two", "b"));
    assert.deepEqual(Object.keys(first), ["a"]);
    assert.deepEqual(Object.keys(second), ["b"]);
    assert.equal(second.b.attribution.creator, "Creator B");

    const uploaded = await loadSceneMediaViews(api, project("two", "upload"));
    assert.deepEqual(uploaded, { upload: views.upload });
    assert.equal(uploaded.upload.attribution, undefined);

    const reopened = await loadSceneMediaViews(api, project("one", "a"));
    assert.equal(reopened.a.attribution.previewUrl, "https://images.pexels.com/a.jpg");
    await assert.rejects(() => loadSceneMediaViews({ request: async () => { throw new Error("offline"); } }, project("one", "a")), /offline/);

    const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
    assert.match(source, /setSceneMedia\(\{\}\);\s+setStatus\("Opening draft/);
    assert.match(source, /setStatus\(hydrationFailed \? "Draft media details could not be loaded\."/);
  } finally {
    await vite.close();
  }
});
test("320px and reduced motion styles are explicit", async () => {
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  assert.match(css, /max-width: 520px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /focus-visible/);
  assert.match(css, /\.app-rail/);
  assert.match(css, /\.app-dock/);
  assert.match(css, /\.studio-board/);
  assert.match(css, /\.crop-guide/);
});

test("studio shell brands F-Motion and keeps real destinations only", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<title>F-Motion<\/title>/);
  assert.match(source, /<strong>F-Motion<\/strong>/);
  assert.doesNotMatch(source, /F-Engine Reference/);
  assert.match(source, /className="app-rail"/);
  assert.match(source, /className="app-dock"/);
  assert.match(source, /className="studio-board"/);
  assert.match(source, /crop-guide/);
  assert.match(source, /href="\/"/);
  assert.doesNotMatch(source, /Assets|Effects|Pro Studio|multitrack/i);
});

test("build puts marketing at site root and studio under /app", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const dist = new URL("../dist/", import.meta.url);
  await access(new URL("index.html", dist));
  await access(new URL("app/index.html", dist));
  await access(new URL("_redirects", dist));
  const home = await readFile(new URL("index.html", dist), "utf8");
  const redirects = await readFile(new URL("_redirects", dist), "utf8");
  const app = await readFile(new URL("app/index.html", dist), "utf8");
  assert.match(home, /Vertical reels from your own media/);
  assert.match(home, /glitch-logo/);
  assert.match(home, /new URL\("\/app\/"/);
  assert.match(home, /searchParams\.set\("project"/);
  assert.match(home, /params\.get\("code"\)/);
  assert.match(app, /\/app\/assets\//);
  assert.match(redirects, /\/web\/ \/\s*301/);
});

test("marketing site ships Stitch-shaped home + integrate without CDN Tailwind", async () => {
  const root = new URL("../public/web/", import.meta.url);
  const home = await readFile(new URL("index.html", root), "utf8");
  const integrate = await readFile(new URL("integrate.html", root), "utf8");
  const css = await readFile(new URL("web.css", root), "utf8");
  const motion = await readFile(new URL("web-motion.js", root), "utf8");
  for (const phrase of [
    "Vertical reels from your own media",
    "brief → storyboard → preview",
    "Open studio",
    "See integration",
    "Your media, your keys",
    "./assets/hero-reel.jpg",
    "./assets/studio-ui.jpg"
  ]) {
    assert.match(home, new RegExp(phrase.replace(/[→]/g, "\\$&")));
  }
  assert.match(home, /new URL\("\/app\/"/);
  assert.match(home, /searchParams\.set\("project"/);
  for (const phrase of [
    "Embed cinematic creation in your product",
    "Integration Recipes",
    "api.f-motion.com",
    "./assets/host-diagram.jpg",
    "MCP Agent Loop"
  ]) {
    assert.match(integrate, new RegExp(phrase));
  }
  assert.doesNotMatch(home, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|assets\/logo\.png/);
  assert.doesNotMatch(integrate, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|assets\/logo\.png/);
  assert.match(css, /--accent:\s*#a54d67/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.glitch-logo/);
  assert.match(css, /font-family:\s*"Syne"|--display:\s*"Syne"/);
  assert.match(css, /syne-700\.woff2/);
  assert.match(home, /data-glitch="rgb-split"/);
  assert.match(home, /data-glitch="scramble-cascade"/);
  assert.match(home, /data-glitch="slice-tear"/);
  assert.match(integrate, /data-glitch="flip-corrupt"/);
  assert.match(integrate, /data-glitch="pulse-shard"/);
  assert.match(motion, /scramble-cascade/);
  assert.match(motion, /prefers-reduced-motion/);
  assert.match(motion, /pagehide/);
  assert.match(motion, /pointerenter/);
  assert.match(motion, /delayedCall\(gsap\.utils\.random/);
  assert.match(home, /skip-link/);
  assert.match(home, /href="#main"/);
  assert.match(home, /class="nav-compact"/);
  assert.match(home, /href="\.\/terms\.html"/);
  assert.match(home, /href="\.\/privacy\.html"/);
  assert.match(home, /hero-reel\.webp/);
  assert.match(home, /type="image\/webp"/);
  assert.doesNotMatch(integrate, /ScrambleTextPlugin/);
  assert.match(integrate, /host-diagram\.webp/);
  assert.doesNotMatch(home, /#docs|View docs/);
  assert.doesNotMatch(integrate, /#docs|View docs/);
  assert.match(integrate, /Open studio →/);
  assert.match(home, /href="\/app\/"/);
  assert.match(integrate, /href="\/app\/"/);
  assert.match(integrate, /href="\.\/terms\.html"/);
  const terms = await readFile(new URL("terms.html", root), "utf8");
  const privacy = await readFile(new URL("privacy.html", root), "utf8");
  assert.match(terms, /Terms of use/);
  assert.match(privacy, /Privacy notice/);
  assert.doesNotMatch(terms, /ScrollTrigger|ScrambleText/);
  assert.match(css, /\.nav-compact/);
  assert.match(css, /\.skip-link/);
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /connect-src[^;]*https:\/\/\*\.supabase\.co/);
  assert.match(headers, /connect-src[^;]*wss:\/\/\*\.supabase\.co/);
  assert.match(home, /params\.get\("code"\)/);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
  for (const asset of [
    "hero-reel.jpg",
    "hero-reel.webp",
    "hero-reel-800.webp",
    "studio-ui.jpg",
    "studio-ui.webp",
    "host-diagram.jpg",
    "host-diagram.webp"
  ]) {
    await readFile(new URL(`assets/${asset}`, root));
  }
  for (const vendor of ["gsap.min.js", "ScrollTrigger.min.js", "ScrambleTextPlugin.min.js"]) {
    await readFile(new URL(`vendor/${vendor}`, root));
  }
  for (const font of ["syne-600.woff2", "syne-700.woff2", "syne-800.woff2"]) {
    await readFile(new URL(`fonts/${font}`, root));
  }
});
