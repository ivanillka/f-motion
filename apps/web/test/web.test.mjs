import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("required recovery, accessibility, and preview language is present", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  for (const phrase of ["Drafts", "Continue to video plan", "Plan the video", "prepared this recommendation from your conversation", "Edit recommended video plan", "Recommended video plan", "What should this video achieve", "Who is it for", "How should the story unfold", "What tone fits best", "How fast should it feel", "Target length", "Where should visuals come from", "Pexels and Pixabay", "Mix Pexels, Pixabay, and my media", "Licensed fill uses Pexels first, then Pixabay for remaining scenes", "Continue to story concepts", "Choose a story approach", "Captions, licensed clips, and a music bed are assembled after you choose", "Building your draft", "This can take a minute", "Your draft", "Edit What you'll say, then record, upload, or generate", "Edit storyboard", "Storyboard", "Live preview", "Play progress", "Restart", "Previous scene", "Next scene", "Find licensed media", "Find another licensed video", "Find licensed still", "Generate AI image for scene", "Animate this image", "Generate one 6-second video", "Use video for scene", "Keep image", "Generate one image", "Get FAL price", "Use for scene", "Keep current media", "Generate another", "AI-generated with FAL", "Charged directly to your FAL account", "Select for scene", "Move scene", "Add scene", "Remove scene", "Play preview", "Pause preview", "Export final", "Final export", "Download export", "playsInline", "Older preview", "Reload latest", "Save as new project", "media not copied", "pending", "was not merged", "Reconnecting", "magic link", "Google", "Pexels", "Pixabay", "Cancel render", "Download preview", "Accurate preview failed", "Retry", "Choose video sources", "Real stock video", "AI stills", "More providers", "Locked", "Pexels stock is locked", "Connect your Pexels API key to search real stock video", "FAL generation is locked", "Open provider settings", "Settings", "Sign out", "Waiting for media inspection", "Media is still inspecting", "Connect your own Pexels API key", "F-Motion does not supply or share a Pexels key", "Connect Pexels", "Test Pexels", "Disconnect Pexels", "Connect your own Pixabay API key", "F-Motion does not supply or share a Pixabay key", "Connect Pixabay", "Test Pixabay", "Disconnect Pixabay", "Connect your own FAL API-scope key", "charged directly to your FAL account", "F-Motion does not supply or share a FAL key", "Connect FAL", "Test connection", "Disconnect", "Sign in to open the imported draft from Fotium.", "Open the email link to finish sign-in.", "Create from my clips", "Fill remaining scenes", "Ready to export", "Download cover", "What you'll say", "Use as captions", "Email or password was rejected.", "Writing the video plan", "Rule-based plan. Connect FAL in Settings for smarter copy.", "FAL conversation was unavailable. Using the rule-based plan.", "FAL wrote this plan and spoken copy", "This spoken copy is planned now so you can edit it before generating a voice-over", "Edit What you'll say, then generate the voice-over", "Close and edit it there if you need to change it", "Create-video copy"]) assert.match(source, new RegExp(phrase));
  assert.match(source, /htmlFor="plan-voice-script"/);
  assert.match(source, /plannedVoiceScript\(/);
  assert.match(source, /id="fal-speech-prompt"[^>]*readOnly/);
  assert.doesNotMatch(source, /setFalSpeechPrompt\(defaultVoicePrompt/);
  assert.match(source, /className="settings-stage"/);
  assert.match(source, /className="source-panel/);
  assert.doesNotMatch(source, /Why is this locked/);
  assert.doesNotMatch(source, /More ways to create/);
  assert.doesNotMatch(source, /Coming soon/);
  assert.doesNotMatch(source, /Privacy and terms will ship/);
  assert.doesNotMatch(source, /Choose your video sources/);
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
  assert.match(source, /setStep\("review"\)/);
  assert.match(source, /setStep\("assemble"\)/);
  assert.match(source, /aria-label="Assembly log"/);
  assert.match(source, /Building your draft/);
  assert.match(source, /noteAssemble\(/);
  assert.match(source, /data-mode=\{step === "review" \? "review" : "edit"\}/);
  assert.match(source, /clientId/);
  assert.doesNotMatch(source, /crypto\.randomUUID\(/);
  assert.match(source, /aria-label=\{\`Choose \$\{concept\.title\} concept\. \$\{concept\.hook\}\`\}/);
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
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.[^\n]*\bpixabayKey\b/);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)\.[^\n]*["'`][^"'`]*PIXABAY/);
  assert.doesNotMatch(source, /VITE_.*PIXABAY/);
});

test("draft media hydration replaces project-scoped stock, upload, reopen, and failure state", async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom"
  });
  try {
    const { ApiResponseError, browserCanPut, captionsFromVoiceScript, clampBpm, clampFocus, durationSecondsFromClipCount, exportGaps, focusFromPoint, formatPlayTime, isWideMedia, jwtEmail, livePlayhead, loadSceneMediaViews, musicLaneBeats, nextLiveSceneId, panFocus, previewPlaysAsVideo, scenePreviewUrl, seekLivePlayhead, showsPartnerBrands, snapDurationToBeat, snapshotFromConflict, stockBedUrl, stockFillStatus } = await vite.ssrLoadModule("/src/api.ts");
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
    assert.equal(browserCanPut("https://storage.example/put", "http://89.1.2.3:8090"), true);
    assert.equal(browserCanPut("http://127.0.0.1:9000/bucket", "http://89.1.2.3:8090"), false);
    assert.equal(browserCanPut("http://127.0.0.1:9000/bucket", "http://127.0.0.1:4173"), true);
    const partnerToken = `x.${btoa(JSON.stringify({ email: "Owner@Example.com" })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}.x`;
    assert.equal(jwtEmail(partnerToken), "owner@example.com");
    assert.equal(showsPartnerBrands(partnerToken, "owner@example.com"), true);
    assert.equal(showsPartnerBrands(partnerToken, "other@example.com"), false);
    assert.equal(showsPartnerBrands(partnerToken, ""), false);
    assert.equal(nextLiveSceneId(["a", "b", "c"], "b"), "c");
    assert.equal(nextLiveSceneId(["a", "b", "c"], "c"), "a");
    assert.equal(scenePreviewUrl({ previewUrl: "https://media.example/still.jpg" }), "https://media.example/still.jpg");
    assert.equal(previewPlaysAsVideo({
      id: "v",
      state: "ready",
      detected: { type: "video/mp4" },
      attribution: { source: "Pexels", creator: "A", attributionUrl: "https://www.pexels.com/a", previewUrl: "https://images.pexels.com/a.jpg" }
    }), false);
    assert.equal(previewPlaysAsVideo({
      id: "v",
      state: "ready",
      detected: { type: "video/mp4" },
      previewUrl: "blob:http://studio/1"
    }), true);
    const blobs = [];
    const blobApi = {
      request: async (path) => views[path.split("/").at(-1)],
      requestBlob: async (path) => {
        blobs.push(path);
        return new Blob(["mp4"], { type: "video/mp4" });
      }
    };
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = () => "blob:test-selfhost";
    try {
      const hydrated = await loadSceneMediaViews(blobApi, project("two", "upload"));
      assert.equal(hydrated.upload.previewUrl, "blob:test-selfhost");
      assert.deepEqual(blobs, ["/api/projects/two/media/upload/content"]);
      const reused = await loadSceneMediaViews(blobApi, project("two", "upload"), hydrated);
      assert.equal(reused.upload.previewUrl, "blob:test-selfhost");
      assert.equal(blobs.length, 1);
    } finally {
      URL.createObjectURL = originalCreate;
    }
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
    const apiSource = await readFile(new URL("../src/api.ts", import.meta.url), "utf8");
    assert.match(source, /hearNewBed\(/);
    assert.match(source, /putAdmittedObject/);
    assert.match(apiSource, /media\/\$\{view\.id\}\/content/);
    assert.match(source, /setSceneMedia\(\{\}\);\s+setStatus\("Opening draft/);
    assert.match(source, /setStatus\(hydrationFailed \? "Draft media details could not be loaded\."/);

    const conflict = new ApiResponseError(409, {
      type: "conflict",
      authoritative_snapshot: { id: "p1", revision: 1, scenes: [{ id: "s1" }] }
    });
    assert.equal(snapshotFromConflict(conflict, "p1")?.revision, 1);
    assert.equal(snapshotFromConflict(conflict, "other"), undefined);
    assert.equal(snapshotFromConflict(new Error("offline"), "p1"), undefined);
    assert.equal(stockFillStatus("pexels_not_connected"), "Connect your Pexels API key in Settings, or upload your own media.");
    assert.equal(stockFillStatus("provider_unavailable"), "Pexels could not be reached. Find clips in the editor, or try again.");
    assert.match(stockFillStatus(undefined), /Find or upload clips/);
    assert.equal(durationSecondsFromClipCount(3), 15);
    assert.equal(durationSecondsFromClipCount(5), 30);
    assert.equal(durationSecondsFromClipCount(8), 45);
    assert.deepEqual(exportGaps({ scenes: [{ media_id: "a", caption: "Hi" }], brief: { soundtrack: {}, voiceover: {} } }), []);
    assert.equal(exportGaps({ scenes: [{ caption: "" }, { caption: "x" }] })[0], "2 scenes need media");
    assert.deepEqual(
      captionsFromVoiceScript("Hello there friends today", [{ id: "a", duration_ms: 1000 }, { id: "b", duration_ms: 1000 }]),
      [{ id: "a", caption: "Hello there" }, { id: "b", caption: "friends today" }]
    );
    assert.match(source, /snapshotFromConflict\(/);
    assert.match(source, /stockFillStatus\(/);
    assert.match(source, /pexelsCredential\?\.connected/);
    assert.doesNotMatch(source, /This draft already has scenes/);
    assert.match(source, /concept\.hook/);
    assert.match(source, /concept\.treatment/);
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
  assert.match(css, /\.concept-module/);
  assert.match(css, /\.beat-rail/);
  assert.match(css, /\.export-gaps/);
  assert.match(css, /\.source-module/);
  assert.match(css, /\.assemble-stage/);
  assert.match(css, /\.assemble-log/);
  assert.match(css, /\.crop-guide/);
  assert.match(css, /cursor: grab/);
  assert.match(css, /cursor: grabbing/);
  assert.match(css, /\.scene-strip-actions/);
  assert.match(css, /\.header-actions \.brand-mark/);
  assert.match(css, /\.music-dock > summary/);
  assert.match(css, /\.plan-voice/);
  assert.match(css, /\.music-dock:not\(\.voice-dock\)/);
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
  assert.match(html, /<meta name="description"/);
  assert.match(source, /<strong>F-Motion<\/strong>/);
  assert.match(source, /Make a vertical preview/);
  assert.match(source, /Create your studio/);
  assert.doesNotMatch(source, /operator token/);
  assert.match(source, /F-Motion — Studio/);
  assert.doesNotMatch(source, /F-Engine Reference/);
  assert.match(source, /className="app-rail"/);
  assert.match(source, /className="app-dock"/);
  assert.match(source, /className="studio-board"/);
  assert.match(source, /className="concept-module"/);
  assert.match(source, /className="source-module"/);
  assert.match(source, /Clips you attach/);
  assert.match(source, /beatSteps\(/);
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
