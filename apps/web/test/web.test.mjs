import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("required recovery, accessibility, and preview language is present", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  for (const phrase of ["Drafts", "Continue to video plan", "Plan the video", "prepared this recommendation from your conversation", "Edit recommended video plan", "Recommended video plan", "What should this video achieve", "Who is it for", "How should the story unfold", "What tone fits best", "How fast should it feel", "Target length", "Where should visuals come from", "Pexels real stock video", "Continue to story concepts", "Choose a story approach", "Licensed visuals are matched only after you choose", "Storyboard", "Live preview", "Play progress", "Restart", "Previous scene", "Next scene", "Find licensed media", "Find another licensed video", "Generate AI image for scene", "Animate this image", "Generate one 6-second video", "Use video for scene", "Keep image", "Generate one image", "Get FAL price", "Use for scene", "Keep current media", "Generate another", "AI-generated with FAL", "Charged directly to your FAL account", "Select for scene", "Move scene", "Add scene", "Remove scene", "Play preview", "Pause preview", "Export final", "Final export", "Download export", "playsInline", "Older preview", "Reload latest", "Save as new project", "media not copied", "pending", "was not merged", "Reconnecting", "magic link", "Google", "Pexels", "Cancel render", "Download preview", "Accurate preview failed", "Retry", "Choose video sources", "Choose your video sources", "Real stock video", "AI stills", "More providers", "More ways to create", "Locked", "Why is this locked", "Pexels stock is locked", "Connect your Pexels API key to search real stock video", "FAL generation is locked", "Open provider settings", "Settings", "Sign out", "Waiting for media inspection", "Media is still inspecting", "Connect your own Pexels API key", "F-Motion does not supply or share a Pexels key", "Connect Pexels", "Test Pexels", "Disconnect Pexels", "Connect your own FAL API-scope key", "charged directly to your FAL account", "F-Motion does not supply or share a FAL key", "Connect FAL", "Test connection", "Disconnect", "Sign in to open the imported draft from Fotium.", "Open the email link to finish sign-in."]) assert.match(source, new RegExp(phrase));
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
  assert.doesNotMatch(source, /requestRender\("preview"\)/);
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
  assert.match(source, /objectPosition/);
  assert.match(source, /Wide still/);
  assert.match(source, /Drag the still to frame it/);
  assert.match(source, /Upload music/);
  assert.match(source, /Snap scenes to beat/);
  assert.match(source, /Music bed/);
  assert.match(source, /Licensed music catalog/);
  assert.match(source, /Add music/);
  assert.match(source, /musicOpen/);
  assert.match(source, /showsPartnerBrands\(/);
  assert.match(source, /VITE_PARTNER_BRAND_EMAIL/);
  assert.match(source, /partner-brands/);
  assert.match(source, /Your galleries/);
  assert.match(source, /fotium\.vip/);
  assert.doesNotMatch(source, /Fotium Motion|Fotium Studio/);
  assert.match(source, /Search licensed music/);
  assert.match(source, /Export final mixes this bed/);
  assert.match(source, /Kevin MacLeod/);
  assert.match(source, /Mixkit/);
  assert.match(source, /Trendy/);
  assert.match(source, /update_soundtrack/);
  assert.match(source, /update_voiceover/);
  assert.match(source, /Record voice-over/);
  assert.match(source, /Upload voice-over/);
  assert.match(source, /Generate with FAL/);
  assert.match(source, /Generate voice-over/);
  assert.match(source, /Use as voice-over/);
  assert.match(source, /spoken subtitles/);
  assert.match(source, /Music ducks under the voice/);
  assert.match(source, /Kokoro American English/);
  assert.match(source, /openFalSpeech\(/);
  assert.match(source, /useFalSpeechMedia\(/);
  assert.doesNotMatch(source, /ElevenLabs|elevenlabs/);
  assert.doesNotMatch(source, /<audio controls/);
  assert.match(source, /htmlFor=\{`caption-\$\{activeScene.id\}`\}/);
  assert.match(source, /Scene \$\{activeSceneNumber\} caption/);
  assert.doesNotMatch(source, /htmlFor=\{`title-\$\{activeScene.id\}`\}/);
  assert.doesNotMatch(source, />Note</);
  assert.match(source, /Overlay look/);
  assert.match(source, /Lower third/);
  assert.match(source, /overlay-look-tile/);
  assert.match(source, /is-ghost/);
  assert.match(source, /Your caption/);
  assert.match(source, /look-\$\{overlayLook\}/);
  assert.match(source, /overlay-title/);
  assert.match(source, /caption-burn/);
  const apiSource = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(apiSource, /Funkorama/);
  assert.match(apiSource, /stockBedUrl/);
  assert.doesNotMatch(source, /horizontal focus/);
  assert.doesNotMatch(source, /focus sliders/);
  assert.doesNotMatch(source, /cropFocus\.x\.toFixed/);
  assert.match(source, /openFalAnimate\(/);
  assert.match(source, /confirmFalVideo\(/);
  assert.match(source, /JPEG, PNG, or WebP portrait/);
  assert.match(source, /type === "validation"/);
  assert.match(source, /falGenerationActive\(/);
  assert.match(source, /Continue editing/);
  assert.match(source, /Animating…/);
  assert.match(source, /Animating scene \$\{activeScene\.order \+ 1\} in the background/);
  assert.match(source, /setFalVideoOpen\(false\)/);
  assert.match(source, /is-preparing/);
  assert.match(source, /Ready — review/);
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
    const { clampBpm, clampFocus, focusFromPoint, formatPlayTime, isWideMedia, jwtEmail, livePlayhead, loadSceneMediaViews, musicLaneBeats, nextLiveSceneId, panFocus, scenePreviewUrl, seekLivePlayhead, showsPartnerBrands, snapDurationToBeat, stockBedUrl } = await vite.ssrLoadModule("/src/api.ts");
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

    assert.equal(clampFocus(undefined), 0.5);
    assert.equal(clampFocus(Number.NaN), 0.5);
    assert.equal(clampFocus(2), 1);
    assert.equal(clampFocus(-0.2), 0);
    assert.equal(isWideMedia(1920, 1080), true);
    assert.equal(isWideMedia(1080, 1920), false);
    assert.equal(isWideMedia(undefined, 1080), false);
    assert.deepEqual(panFocus({ x: 0.5, y: 0.5 }, { x: 0.25, y: -0.1 }), { x: 0.25, y: 0.6 });
    assert.deepEqual(focusFromPoint({ x: 20, y: 80 }, { width: 100, height: 100 }), { x: 0.2, y: 0.8 });
    assert.equal(clampBpm(40), 60);
    assert.equal(snapDurationToBeat(3750, 120), 4000);
    assert.equal(musicLaneBeats(2000, 120).length, 5);
    assert.equal(stockBedUrl("pulse"), "/music/pulse.mp3");
    assert.equal(stockBedUrl(undefined), undefined);
    const partnerToken = `x.${btoa(JSON.stringify({ email: "Owner@Example.com" })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}.x`;
    assert.equal(jwtEmail(partnerToken), "owner@example.com");
    assert.equal(showsPartnerBrands(partnerToken, "owner@example.com"), true);
    assert.equal(showsPartnerBrands(partnerToken, "other@example.com"), false);
    assert.equal(showsPartnerBrands(partnerToken, ""), false);
    assert.equal(nextLiveSceneId(["a", "b", "c"], "b"), "c");
    assert.equal(nextLiveSceneId(["a", "b", "c"], "c"), "a");
    assert.equal(scenePreviewUrl({ previewUrl: "https://media.example/still.jpg" }), "https://media.example/still.jpg");
    const scenes = [
      { id: "a", duration_ms: 1000 },
      { id: "b", duration_ms: 3000 },
      { id: "c", duration_ms: 2000 }
    ];
    assert.equal(formatPlayTime(1500), "0:01");
    assert.deepEqual(seekLivePlayhead(scenes, 3500), { sceneId: "b", sceneElapsedMs: 2500 });
    assert.equal(livePlayhead(scenes, "b", 500).offsetMs, 1500);
    assert.equal(livePlayhead(scenes, "b", 500).totalMs, 6000);

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
  assert.match(css, /cursor: grab/);
  assert.match(css, /cursor: grabbing/);
  assert.match(css, /\.scene-strip-actions/);
  assert.match(css, /\.header-actions \.brand-mark/);
  assert.match(css, /\.music-dock > summary/);
  assert.match(css, /\.music-dock:not\(\[open\]\) > \*:not\(summary\) \{ display: none; \}/);
  assert.match(css, /minmax\(0, 1fr\) 232px/);
  assert.match(css, /preview-push/);
  assert.match(css, /preview-push-wide/);
  assert.match(css, /scene-prepare-pulse/);
  assert.match(css, /\.preview-preparing/);
  assert.match(css, /\.scene-card\.is-preparing/);
  assert.match(css, /transform-origin: 50% 50%/);
  assert.match(css, /preview-zoom \{\s*from \{ transform: scale\(1\.08\)/);
  assert.match(css, /\.preview-grade/);
  assert.match(css, /\.caption-burn/);
  assert.match(css, /\.look-title/);
  assert.match(css, /\.look-poster/);
  assert.match(css, /\.look-poster\.overlay-bottom \{\s*align-self: end;\s*margin-bottom: 0;/);
  assert.match(css, /\.overlay-look-tile/);
  assert.match(css, /\.caption-burn \{\s*z-index: 4;/);
  assert.match(css, /font-family: Inter/);
  assert.match(css, /Inter-SemiBold\.ttf/);
  assert.match(css, /InterDisplay-ExtraBold\.ttf/);
  assert.match(css, /\.overlay-places/);
  assert.match(css, /\.editor-foot/);
  assert.match(css, /\.inspector-pair/);
  assert.match(css, /\.app-shell-editor \.app-stage \{\s*max-width: none;/);
  assert.match(css, /margin-inline: auto/);
  assert.match(css, /dialog\[open\][\s\S]{0,180}max-height: calc\(100dvh - 24px\)/);
  assert.match(css, /dialog img/);
  assert.doesNotMatch(css, /display: contents/);
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
  assert.match(source, /partner-brands/);
  assert.match(source, /className="editor-foot"/);
  assert.match(source, /crop-guide/);
  assert.match(source, /isWideMedia/);
  assert.match(source, /motion: "zoom"/);
  assert.match(source, /href="\/"/);
  assert.match(source, /MarketingApp/);
  assert.match(source, /\/studio/);
  assert.doesNotMatch(source, /Assets|Effects|Pro Studio|multitrack/i);
});

test("build puts the SPA at site root and redirects /app to /studio", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const dist = new URL("../dist/", import.meta.url);
  await access(new URL("index.html", dist));
  await access(new URL("_redirects", dist));
  await access(new URL("music/pulse.mp3", dist));
  const home = await readFile(new URL("index.html", dist), "utf8");
  const redirects = await readFile(new URL("_redirects", dist), "utf8");
  assert.match(home, /<div id="root">/);
  assert.match(home, /<title>F-Motion<\/title>/);
  assert.match(redirects, /\/app \/studio\s+301/);
  assert.doesNotMatch(redirects, /\/index\.html\s+200/);
  for (const page of ["self-host.html", "hosted.html", "studio.html"]) {
    const copy = await readFile(new URL(page, dist), "utf8");
    assert.equal(copy, home);
  }
});

test("legal pages and marketing assets stay local with no CDN Tailwind", async () => {
  const root = new URL("../public/web/", import.meta.url);
  const terms = await readFile(new URL("terms.html", root), "utf8");
  const privacy = await readFile(new URL("privacy.html", root), "utf8");
  const css = await readFile(new URL("web.css", root), "utf8");
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(terms, /Terms of use/);
  assert.match(privacy, /Privacy notice/);
  assert.doesNotMatch(terms, /cdn\.tailwindcss\.com|fonts\.googleapis\.com/);
  assert.match(css, /--accent:\s*#a54d67/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
  for (const asset of [
    "hero-reel.jpg",
    "hero-reel.webp",
    "studio-ui.jpg",
    "studio-ui.webp"
  ]) {
    await readFile(new URL(`assets/${asset}`, root));
  }
  for (const font of ["syne-600.woff2", "syne-700.woff2", "syne-800.woff2"]) {
    await readFile(new URL(`fonts/${font}`, root));
  }
});
