import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("required recovery, accessibility, and preview language is present", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  for (const phrase of ["Drafts", "Add photos or clips", "Try again", "Storyboard", "What’s new", "Full changelog on GitHub", "Live preview", "Play progress", "Restart", "Previous scene", "Next scene", "Find licensed media", "Find another licensed video", "Generate AI image for scene", "Animate this image", "Generate one 6-second video", "Use video for scene", "Keep image", "Generate one image", "Get FAL price", "Use for scene", "Keep current media", "Generate another", "AI-generated with FAL", "Charged directly to your FAL account", "Select for scene", "Move scene", "Add scene", "Remove scene", "Play preview", "Pause preview", "Export video", "Final export", "Download export", "playsInline", "Older preview", "Reload latest", "Save as new project", "media not copied", "Save as template", "Save template", "Update template", "Templates", "media not stored", "Overwrite from this draft", "pending", "was not merged", "Reconnecting", "magic link", "Google", "Pexels", "Cancel render", "Download preview", "Accurate preview failed", "Retry", "Choose video sources", "Choose your video sources", "Real stock video", "AI stills", "More providers", "More ways to create", "Locked", "Why is this locked", "Pexels stock is locked", "Connect your Pexels API key to search real stock video", "FAL generation is locked", "Open provider settings", "Settings", "Sign out", "Waiting for media inspection", "Media is still inspecting", "Connect your own Pexels API key", "F-Motion does not supply or share a Pexels key", "Connect Pexels", "Test Pexels", "Disconnect Pexels", "Connect your own FAL API-scope key", "charged directly to your FAL account", "F-Motion does not supply or share a FAL key", "Connect FAL", "Test connection", "Disconnect", "Sign in to open the imported draft.", "Open the email link to finish sign-in.", "Delete"]) assert.match(source, new RegExp(phrase));
  assert.match(source, /applyStoryboardTemplate\(/);
  assert.match(source, /openSaveTemplate\(/);
  assert.match(source, /snapshotToTemplate\(/);
  assert.match(source, /from "\.\/storyboard-templates"/);
  assert.match(source, /deleteDraft\(/);
  assert.match(source, /window\.confirm\(/);
  assert.match(source, /Delete .+ permanently\? This cannot be undone\./);
  assert.match(source, /api\.deleteProject\(/);
  assert.match(source, /className="secondary draft-delete"/);
  assert.match(source, /className="draft-open"/);
  assert.match(source, /activeSceneId/);
  assert.match(source, /build-rev/);
  assert.match(source, /VITE_GIT_SHA/);
  assert.doesNotMatch(source, /disabled=\{!allScenesHavePreview\}/);
  assert.match(source, /openConflict\(/);
  assert.match(source, /intendedSceneId/);
  assert.match(source, /find\(\(\{ id \}\) => id === activeSceneId\)/);
  assert.match(source, /find\(\(\{ id \}\) => id === sceneId\)/);
  assert.doesNotMatch(source, /saveScenePatch[\s\S]{0,120}scenes\[0\]/);
  assert.doesNotMatch(source, /searchStock[\s\S]{0,120}scenes\[0\]/);
  assert.match(source, /setCandidates\(body\.results\.slice\(0, 3\)\)/);
  assert.doesNotMatch(source, /selectStock[\s\S]{0,120}scenes\[0\]/);
  assert.doesNotMatch(source, /Test stale revision|Choose one concept/);
  assert.doesNotMatch(source, /Automatically matched|strongest licensed match|Finding the best/);
  assert.doesNotMatch(source, /concept_id:\s*"direct"/);
  assert.doesNotMatch(source, /Create storyboard|Choose a story approach|Continue to story concepts/);
  assert.match(source, /buildStoryboard\(/);
  assert.match(source, /continueToStoryboard\(/);
  assert.match(source, /generateReelSession\(/);
  assert.match(source, /materializeReelProject\(/);
  assert.match(source, /media-sources-strip/);
  assert.match(source, /Making your storyboard/);
  assert.match(source, /Make my storyboard now/);
  assert.match(source, /scene-caption-hint/);
  // Scene cards show the caption or a plain hint, never the internal image prompt.
  assert.doesNotMatch(source, /scene\.caption \|\| scene\.visual_prompt/);
  assert.match(source, /Turn photos into motion/);
  assert.match(source, /animateStills/);
  assert.match(source, /beginAnimateStillsQueue\(/);
  assert.match(source, /conceptIdForArchitecture/);
  assert.match(source, /briefPurposeFromChat/);
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
  assert.match(source, /Reels start on the host/);
  assert.doesNotMatch(source, /Galleries · unlocked/);
  assert.doesNotMatch(source, /100\.121\.204|tailf28d35|ubuntu-8gb-hel1/);
  assert.match(source, /VITE_PARTNER_GALLERY_URL/);
  assert.doesNotMatch(source, /Fotium Motion|Fotium Studio/);
  assert.match(source, /Search licensed music/);
  assert.match(source, /Export video mixes this bed/);
  assert.match(source, /Stock beds/);
  assert.match(source, /Stock music beds/);
  assert.match(source, /Suggested for/);
  assert.match(source, /suggestedStockBed/);
  assert.match(source, /stockBedCredit/);
  assert.doesNotMatch(source, /Classic Kevin MacLeod beds/);
  assert.match(source, /Mixkit/);
  assert.match(source, /Trendy/);
  assert.match(source, /update_soundtrack/);
  assert.match(source, /update_voiceover/);
  assert.match(source, /update_reel/);
  assert.match(source, /Closing question/);
  assert.match(source, /F-Motion mark/);
  assert.match(source, /Reel 9:16/);
  assert.match(source, /Desktop 16:9/);
  assert.match(source, /name="output-frame"/);
  assert.match(source, /Mix in Pexels videos, images made with AI, and diagrams/);
  assert.match(source, /This shot is AI footage/);
  assert.match(source, /This shot is a diagram/);
  assert.match(source, /Download desktop/);
  assert.match(source, /reel-mark/);
  assert.match(source, /className="reel-mark"/);
  assert.match(source, /brand\/mark\.html/);
  assert.match(source, /Record voice-over/);
  assert.match(source, /Upload voice-over/);
  assert.match(source, /Spoken lines use Kokoro American English/);
  assert.doesNotMatch(source, /Generate with FAL/);
  assert.doesNotMatch(source, /Use as voice-over/);
  assert.doesNotMatch(source, /speech-quotes/);
  assert.doesNotMatch(source, /defaultVoiceoverPrompt/);
  assert.doesNotMatch(source, /openFalSpeech\(/);
  assert.doesNotMatch(source, /useFalSpeechMedia\(/);
  assert.match(source, /spoken-word/);
  assert.match(source, /is-current/);
  assert.match(source, /highlight each word/);
  assert.doesNotMatch(source, /spokenCue/);
  assert.match(source, /Music ducks under the voice/);
  assert.match(source, /Start offset/);
  assert.match(source, /htmlFor="voice-offset"/);
  assert.match(source, /Mute voice-over/);
  assert.match(source, /Unmute voice-over/);
  assert.match(source, /Voice-over never loops/);
  assert.match(source, /previewMediaShouldLoop\(/);
  assert.match(source, /previewVideoRef\.current\?\.pause\(\)/);
  assert.match(source, /setPlaySceneId\(nextId\)/);
  assert.match(source, /setActiveSceneId\(nextId\)/);
  assert.doesNotMatch(source, /loop=\{!livePlaying\}/);
  assert.match(source, /Message F-Motion/);
  assert.match(source, /sendBrief\(/);
  assert.match(source, /Create chat/);
  assert.match(source, /Suggested answers/);
  assert.doesNotMatch(source, /asks at most four missing questions/);
  assert.doesNotMatch(source, /Plan the video/);
  assert.doesNotMatch(source, /More settings/);
  assert.doesNotMatch(source, /architecture-summary/);
  assert.match(source, /BRIEF_OPENING/);
  assert.match(source, /LOOKING_AT_MEDIA/);
  assert.match(source, /DROP_OWN_MEDIA/);
  assert.match(source, /glanceLocalMedia/);
  assert.match(source, /briefNeedsMediaLook/);
  assert.match(source, /lookAtOwnMedia/);
  assert.doesNotMatch(source, /Visual description/);
  assert.match(source, /Kokoro American English/);
  assert.match(source, /voiceoverPlayback\(/);
  assert.match(source, /loadedmetadata/);
  assert.doesNotMatch(source, /if \(!duration \|\| at >= duration\)/);
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
  assert.match(apiSource, /@f-engine\/contracts/);
  assert.match(apiSource, /stockBedUrl/);
  assert.doesNotMatch(apiSource, /export const stockBeds = \[/);
  assert.match(apiSource, /Looking at your photos/);
  assert.match(apiSource, /Add your photos or clips/);
  assert.match(apiSource, /I looked at/);
  assert.match(apiSource, /deleteProject\(/);
  assert.match(apiSource, /method: "DELETE"/);
  assert.doesNotMatch(source, /horizontal focus/);
  assert.doesNotMatch(source, /focus sliders/);
  assert.doesNotMatch(source, /cropFocus\.x\.toFixed/);
  assert.match(source, /openFalAnimate\(/);
  assert.match(source, /confirmFalVideo\(/);
  assert.match(source, /JPEG, PNG, or WebP portrait/);
  assert.match(source, /type === "validation"/);
  assert.match(source, /falGenerationActive\(/);
  assert.match(source, /Continue editing/);
  assert.match(source, /Adding motion…/);
  assert.match(source, /Animating scene \$\{activeScene\.order \+ 1\} in the background/);
  assert.match(source, /setFalVideoOpen\(false\)/);
  assert.match(source, /is-preparing/);
  assert.match(source, /Ready\. Review/);
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
    const { clampBpm, clampFocus, clampOffsetMs, focusFromPoint, formatPlayTime, isWideMedia, jwtEmail, livePlayhead, loadSceneMediaViews, musicLaneBeats, nextLiveSceneId, panFocus, previewMediaShouldLoop, scenePreviewUrl, seekLivePlayhead, showsPartnerBrands, snapDurationToBeat, snapScenesToBeat, spokenNarrationReady, stockBedUrl, stockBeds, suggestedStockBed, stockBedCredit, voiceoverPlayback } = await vite.ssrLoadModule("/src/api.ts");
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
    assert.equal(clampOffsetMs(-20), 0);
    assert.equal(clampOffsetMs(250.4), 250);
    assert.equal(clampOffsetMs(900_000), 600_000);
    assert.equal(previewMediaShouldLoop(true, false), false);
    assert.equal(previewMediaShouldLoop(false, true), false);
    assert.equal(previewMediaShouldLoop(false, false), true);
    assert.equal(snapDurationToBeat(3750, 120), 4000);
    const bpm = 174;
    const beat = 60_000 / bpm;
    const beatCounts = [4, 3, 6, 7, 4, 3, 6, 4, 7, 3, 6, 4, 3, 7, 6, 4, 3, 6, 7, 4, 3, 6, 4];
    const snapped = snapScenesToBeat(beatCounts.map((beats, order) => ({
      id: `beat-${order}`,
      order,
      duration_ms: beats * beat
    })), bpm);
    let beatsSoFar = 0;
    let elapsedMs = 0;
    for (const [index, duration_ms] of snapped.entries()) {
      beatsSoFar += beatCounts[index];
      elapsedMs += duration_ms;
      const expectedFrame = (beatsSoFar * beat / 1000) * 30;
      const actualFrame = (elapsedMs / 1000) * 30;
      assert.ok(
        Math.abs(actualFrame - expectedFrame) <= 1,
        `snapped cut ${index} is ${(actualFrame - expectedFrame).toFixed(2)} frames off the beat grid`
      );
    }
    assert.equal(musicLaneBeats(2000, 120).length, 5);
    assert.equal(stockBedUrl("pulse"), "/music/pulse.mp3");
    assert.equal(stockBedUrl("banger"), "/music/banger.mp3");
    assert.equal(stockBedUrl("rush"), "/music/rush.mp3");
    assert.equal(stockBedUrl(undefined), undefined);
    assert.equal(suggestedStockBed(174)?.id, "rush");
    assert.ok(stockBeds.every((bed) => bed.license && bed.licenseUrl && bed.bpm));
    assert.ok(stockBeds.every((bed) => !stockBedCredit(bed).includes("\u2014")));
    assert.ok(stockBeds.some((bed) => bed.id === "banger" && bed.bpm === 170));
    assert.ok(stockBeds.some((bed) => bed.id === "rush" && bed.bpm === 172));
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
    assert.deepEqual(voiceoverPlayback(0, 0, undefined), { play: true });
    assert.deepEqual(voiceoverPlayback(0, 0, 0), { play: true });
    assert.deepEqual(voiceoverPlayback(1500, 0, 8), { play: true, currentTime: 1.5 });
    assert.deepEqual(voiceoverPlayback(8000, 0, 8), { play: false });
    assert.deepEqual(voiceoverPlayback(0, 250, 8), { play: true, currentTime: 0.25 });

    const uploaded = await loadSceneMediaViews(api, project("two", "upload"));
    assert.deepEqual(uploaded, { upload: views.upload });
    assert.equal(uploaded.upload.attribution, undefined);

    const reopened = await loadSceneMediaViews(api, project("one", "a"));
    assert.equal(reopened.a.attribution.previewUrl, "https://images.pexels.com/a.jpg");
    await assert.rejects(() => loadSceneMediaViews({ request: async () => { throw new Error("offline"); } }, project("one", "a")), /offline/);

    const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
    assert.match(source, /setSceneMedia\(\{\}\);\s+setStatus\("Opening draft/);
    assert.match(source, /setStatus\(hydrationFailed \? "Draft media details could not be loaded\."/);
    assert.match(source, /attachSpokenVoice\(found\.project\)/);
    assert.match(source, /\/spoken-narration/);
    const play = source.slice(source.indexOf("function playLivePreview"), source.indexOf("function pauseLivePreview"));
    assert.doesNotMatch(play, /spoken-narration/);
    assert.equal(spokenNarrationReady({
      scenes: [{ overlay_look: "spoken", caption: "Read the full post.", duration_ms: 6000 }],
      brief: {}
    }), false);
  } finally {
    await vite.close();
  }
});
test("sources ride in the header as slim chips instead of a full-width strip", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  // The strip renders inside <header> ahead of the actions, so no screen leads
  // with its own full-width Sources block.
  assert.match(
    source,
    /<header>\s*<div className="header-identity">[\s\S]{0,700}?\{sourcesStrip\}\s*<div className="header-actions">/
  );
  assert.doesNotMatch(source, /media-sources-label|drafts-sources-hint/);
  const strip = source.slice(source.indexOf("const sourcesStrip"), source.indexOf("const appNav"));
  assert.ok(strip.includes("media-sources-strip"));
  assert.ok(strip.includes("media-source-dot"));
  assert.ok(strip.includes("animate-stills-reason"));
  assert.doesNotMatch(strip, /Manage/);
  // State also rides in the chip's title, so the phone layout can hide the
  // state word visually without dropping it from the accessible name.
  assert.match(strip, /title=\{`\$\{chip\.label\}: \$\{chip\.detail\}`\}/);
  // Chips are pills; only the detail word is visually hidden on phones.
  assert.match(css, /\.media-source-chip \{[\s\S]{0,260}?border-radius: 999px;/);
  assert.match(css, /@media \(max-width: 520px\) \{\s*\.media-source-detail \{[\s\S]{0,320}?clip-path: inset\(50%\)/);
  assert.match(css, /\.animate-stills-reason \{[^}]*color: var\(--muted\)/);
});
test("brand type scale is self-hosted Space Grotesk over a 16px body, and rose is the only accent", async () => {
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");
  const license = await readFile(new URL("../src/fonts/OFL.txt", import.meta.url), "utf8");
  // One variable woff2, shipped from the app so the CSP keeps font-src 'self'.
  assert.match(
    css,
    /@font-face \{\s*font-family: "Space Grotesk";[\s\S]{0,220}?url\("\.\/fonts\/space-grotesk-latin\.woff2"\) format\("woff2"\)/
  );
  assert.match(license, /SIL OPEN FONT LICENSE/i);
  assert.match(css, /--font-heading: "Space Grotesk", ui-sans-serif/);
  // Body copy sits at 16px; supporting copy and metadata are single tokens.
  assert.match(css, /--text-micro: 0\.75rem/);
  assert.match(css, /--text-support: 0\.875rem/);
  assert.match(css, /--text-body: 1rem/);
  assert.match(css, /--text-card: 1\.125rem/);
  assert.match(css, /--text-section: 1\.25rem/);
  assert.match(css, /--text-display: clamp\(1\.75rem, 5vw, 2\.75rem\)/);
  assert.match(css, /body \{[^}]*font-size: var\(--text-body\)/);
  assert.match(css, /h1 \{\s*font-size: var\(--text-display\)/);
  assert.match(css, /h1, h2, h3, h4, h5, h6,\s*header strong,[\s\S]{0,400}?font-family: var\(--font-heading\)/);
  // Higher-contrast secondary grey for 14px supporting copy.
  assert.match(css, /--muted: #bec5cc/);
  assert.doesNotMatch(css, /#a6adb5/);
  // Rose owns the studio accent: the cyan HUD line and the per-provider /
  // chart neon colors are gone.
  assert.match(css, /--hud-line: rgba\(255, 177, 196, 0\.28\)/);
  assert.match(css, /\.header-actions \.brand-mark\.is-on \{\s*color: var\(--accent-soft\)/);
  assert.doesNotMatch(css, /0, 229, 255|#00e5ff|#7dffe3|#9ef6ff|#7c5cff|#8b5cff|#05a081|#00dbe9|#ffe000/i);
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
  assert.match(css, /preview-zoom \{\s*from \{ transform: scale\(1\); \}\s*to \{ transform: scale\(1\.3\); \}/);
  assert.match(css, /preview-push-wide \{\s*from \{ transform: scale\(1\.25\) translate3d\(10%, 0, 0\)/);
  assert.match(css, /preview-zoom var\(--scene-ms, 3s\) ease-in-out/);
  assert.match(css, /\.preview img\.is-frozen, \.preview video\.is-frozen \{\s*animation-play-state: paused/);
  assert.match(css, /\.brief-chat/);
  assert.match(css, /\.app-shell-brief/);
  assert.match(css, /\.brief-composer textarea \{[\s\S]*min-height: 44px/);
  // The phone dock owns the bottom strip: the pinned composer, the dock itself, and
  // every studio screen keep the dock height plus the OS home-indicator inset clear.
  assert.match(css, /--safe-bottom: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /--dock-h: calc\(var\(--dock\) \+ var\(--safe-bottom\)\)/);
  assert.match(css, /\.app-stage \{\s*min-width: 0;\s*min-height: 100dvh;\s*padding: 24px 24px calc\(24px \+ var\(--safe-bottom\)\);/);
  assert.match(css, /\.app-shell-editor \.app-stage \{\s*max-width: none;\s*padding: 12px 20px calc\(20px \+ var\(--safe-bottom\)\);/);
  assert.match(css, /\.app-shell-signed \.app-stage,\n  \.app-shell-editor \.app-stage \{ padding-bottom: calc\(var\(--dock-h\) \+ 20px\); \}/);
  assert.match(css, /\.app-dock \{[\s\S]{0,200}height: var\(--dock-h\);[\s\S]{0,60}padding: 6px 8px calc\(6px \+ var\(--safe-bottom\)\);/);
  assert.match(css, /@media \(max-width: 899px\) \{\s*\.brief-composer \{ bottom: var\(--dock-h\); \}\s*\}/);
  // The phone shell must grow with its content; a viewport-tall grid row swallowed
  // the dock padding and left tall screens (Storyboard) scrolled under the dock.
  assert.match(css, /\.app-space \.app-shell \{[\s\S]{0,600}display: block;/);
  assert.match(css, /\.app-space \.app-stage \{\s*height: auto;\s*min-height: 100dvh;\s*\}/);
  assert.match(css, /\.app-stage \{ padding: 16px 16px calc\(16px \+ var\(--safe-bottom\)\); \}/);
  assert.match(css, /\.preview-grade/);
  assert.match(css, /\.caption-burn/);
  assert.match(css, /\.look-title/);
  assert.match(css, /\.look-spoken/);
  assert.match(css, /\.preview \.reel-mark \{[\s\S]*top:\s*5%/);
  assert.match(css, /\.preview \.reel-mark \{[\s\S]*right:\s*6%/);
  assert.match(css, /\.preview \.reel-mark \{[\s\S]*width:\s*42%/);
  assert.match(css, /\.preview \.reel-mark \{[\s\S]*aspect-ratio:\s*960 \/ 200/);
  assert.match(css, /\.preview\.is-desktop \{[^}]*aspect-ratio:\s*16 \/ 9/);
  assert.match(css, /\.frame-choice label \{[\s\S]*min-height:\s*44px/);
  assert.match(css, /label\.mix-choice \{[\s\S]*min-height:\s*44px/);
  const mark = await readFile(new URL("../public/brand/mark.html", import.meta.url), "utf8");
  assert.match(mark, /flex-direction:\s*row/);
  assert.doesNotMatch(mark, /flex-direction:\s*column/);
  assert.match(mark, /--s:\s*64px/);
  assert.match(mark, /\.wordmark \{[^}]*width:\s*760px/);
  assert.match(mark, /animation:\s*launchTumble 36s linear infinite/);
  assert.match(mark, /animation:\s*launchSweep 9s ease-in-out infinite/);
  assert.match(mark, /rgba\(0, 229, 255, 0\.72\)/);
  assert.match(mark, /#f1f2f3/);
  assert.match(mark, /#d989a0/);
  assert.match(mark, /M631 -647V-536H133/);
  assert.doesNotMatch(mark, /Fotium/i);
  assert.doesNotMatch(css, /\.preview \.reel-mark \{[^}]*left:\s*8%/);
  assert.match(css, /\.look-poster/);
  assert.match(css, /\.look-poster\.overlay-bottom \{\s*align-self: end;\s*margin-bottom: 0;/);
  assert.match(css, /\.overlay-look-tile/);
  assert.match(css, /\.caption-burn \{\s*z-index: 4;/);
  assert.match(css, /\.spoken-word\.is-current/);
  assert.match(css, /#d989a0/);
  assert.match(css, /font-family: Inter/);
  assert.match(css, /Inter-SemiBold\.ttf/);
  assert.match(css, /InterDisplay-ExtraBold\.ttf/);
  assert.match(css, /\.overlay-places/);
  assert.match(css, /\.editor-foot/);
  assert.match(css, /\.inspector-pair/);
  assert.match(css, /\.app-shell-editor \.app-stage \{\s*max-width: none;/);
  assert.match(css, /--hud-w: min\(1100px, 92vw\)/);
  assert.match(css, /--hud-h: min\(800px, 88vh\)/);
  assert.match(css, /\.app-space-stage \{\s*position: relative;[\s\S]*width: var\(--hud-w\);[\s\S]*height: var\(--hud-h\);/);
  assert.match(css, /@media \(max-width: 899px\) \{\s*\.app-space \{[\s\S]*--hud-w: 100vw;[\s\S]*--hud-h: 100dvh;/);
  assert.doesNotMatch(css, /\.app-space[^{]*\{[^}]*--hud-w:[^}]*22rem/);
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
  assert.match(source, /className=\{`app-space/);
  assert.match(source, /app-space-cube/);
  assert.doesNotMatch(source, /mkt-studio-face|mkt-cube-core/);
  assert.match(source, /className="studio-board"/);
  assert.match(source, /partner-brands/);
  assert.match(source, /className="editor-foot"/);
  assert.match(source, /crop-guide/);
  assert.match(source, /isWideMedia/);
  assert.match(source, /motion: "zoom"/);
  assert.match(source, /href="\/"/);
  assert.doesNotMatch(source, /Assets|Effects|Pro Studio|multitrack/i);
});

test("self-host vite build serves the studio at /", async () => {
  const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(source, /VITE_SELFHOST_AUTH === "1"/);
  assert.doesNotMatch(source, /VITE_SITE_AT_ROOT/);
});

test("build puts marketing at site root with studio under /app", async () => {
  const { readFile, access } = await import("node:fs/promises");
  const dist = new URL("../dist/", import.meta.url);
  await access(new URL("index.html", dist));
  await access(new URL("app/index.html", dist));
  await access(new URL("_redirects", dist));
  await access(new URL("music/pulse.mp3", dist));
  const home = await readFile(new URL("index.html", dist), "utf8");
  const redirects = await readFile(new URL("_redirects", dist), "utf8");
  assert.match(home, /Turn stills and clips into short motion reels/);
  assert.doesNotMatch(home, /fotium/i);
  assert.match(home, />Soon</);
  assert.doesNotMatch(home, /href="\/app\/"/);
  const czech = await readFile(new URL("cs/index.html", dist), "utf8");
  assert.match(czech, />Brzy</);
  assert.match(czech, /Jak to funguje/);
  assert.doesNotMatch(czech, /fotium/i);
  assert.doesNotMatch(home, /id="root"/);
  assert.doesNotMatch(home, /mkt-cube/);
  const spa = await readFile(new URL("app/index.html", dist), "utf8");
  assert.match(spa, /\/app\/assets\/index-/);
  const entryJs = spa.match(/\/app\/assets\/(index-[^"]+\.js)/)?.[1];
  assert.ok(entryJs, "hashed studio entry");
  const entry = await readFile(new URL(`app/assets/${entryJs}`, dist), "utf8");
  assert.doesNotMatch(entry, /InterDisplay/);
  const { readdir } = await import("node:fs/promises");
  const assets = await readdir(new URL("app/assets/", dist));
  assert.ok(assets.some((name) => name.startsWith("main-") && name.endsWith(".js")));
  assert.match(redirects, /\/studio\/ \/\s*app\//);
  assert.match(redirects, /\/web\/ \/\s*301/);
  const integrateLive = await readFile(new URL("integrate.html", dist), "utf8");
  assert.match(integrateLive, /CMS plugin/);
  assert.match(integrateLive, /Four supported paths/);
  assert.doesNotMatch(integrateLive, /id="root"/);
  const agentsLive = await readFile(new URL("agents.html", dist), "utf8");
  assert.match(agentsLive, /Ask an agent\. Keep the draft/);
});

test("marketing site ships Stitch-shaped home + integrate without CDN Tailwind", async () => {
  const root = new URL("../public/web/", import.meta.url);
  const home = await readFile(new URL("index.html", root), "utf8");
  const integrate = await readFile(new URL("integrate.html", root), "utf8");
  const css = await readFile(new URL("web.css", root), "utf8");
  const motion = await readFile(new URL("web-motion.js", root), "utf8");
  for (const phrase of [
    "Turn stills and clips into short motion reels.",
    "View on GitHub",
    "Open Studio",
    ">Soon<",
    "How it works",
    "Atelier, sitting room, still life, mist.",
    "Built for Prague studio workflows and short motion reels.",
    "href=\"/cs/\""
  ]) {
    assert.match(home, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(home, /href="\/login"/);
  const redirect = await readFile(new URL("launch-redirect.js", root), "utf8");
  assert.match(home, /<script src="\.\/launch-redirect\.js"><\/script>/);
  assert.doesNotMatch(home, /<script(?![^>]*\bsrc=)/);
  assert.match(redirect, /new URL\("\/app\/"/);
  assert.match(redirect, /searchParams\.set\("project"/);
  assert.match(redirect, /params\.get\("code"\)/);
  assert.match(redirect, /error_code/);
  for (const phrase of [
    "Embed cinematic creation in your product",
    "Integration recipes",
    "api.f-motion.com",
    "./assets/host-diagram.jpg",
    "MCP agent loop",
    "CMS plugin",
    "Four supported paths",
    "reel_ready",
    "cms-plugin.md",
    "./agents.html",
    "FENGINE_IMPORT_TOKEN",
    "notify_url",
    "does not post to social",
    "cms:gallery:weekend"
  ]) {
    assert.match(integrate, new RegExp(phrase));
  }
  assert.doesNotMatch(integrate, /\u2014/);
  assert.doesNotMatch(integrate, /mailto:/);
  const agents = await readFile(new URL("agents.html", root), "utf8");
  for (const phrase of [
    "Ask an agent. Keep the draft.",
    "Media first",
    "Chat only",
    "./assets/fmotion-agents-hero.jpg",
    "./assets/fmotion-media-first.jpg",
    "./assets/fmotion-chat-only.jpg",
    "og:image"
  ]) {
    assert.match(agents, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(home, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|assets\/logo\.png/);
  assert.doesNotMatch(integrate, /cdn\.tailwindcss\.com|fonts\.googleapis\.com|assets\/logo\.png/);
  assert.match(css, /--accent:\s*#a54d67/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.glitch-logo/);
  assert.match(css, /font-family:\s*"Syne"|--display:\s*"Syne"/);
  assert.match(css, /syne-700\.woff2/);
  assert.match(css, /\.recipes-quad/);
  assert.doesNotMatch(home, /data-glitch=/);
  assert.match(integrate, /data-glitch="flip-corrupt"/);
  assert.match(integrate, /data-glitch="pulse-shard"/);
  assert.match(motion, /scramble-cascade/);
  assert.match(motion, /prefers-reduced-motion/);
  assert.match(motion, /pagehide/);
  assert.match(motion, /pointerenter/);
  assert.match(motion, /delayedCall\(gsap\.utils\.random/);
  assert.match(home, /skip-link/);
  assert.match(home, /href="#main"/);
  assert.match(home, /launch-frame/);
  assert.match(home, /<source src="\.\/assets\/demo-reel\.webm" type="video\/webm">/);
  assert.match(home, /<source src="\.\/assets\/demo-reel\.mp4" type="video\/mp4">/);
  assert.doesNotMatch(home, /Full demo soon/);
  assert.doesNotMatch(integrate, /ScrambleTextPlugin/);
  assert.match(integrate, /host-diagram\.webp/);
  assert.doesNotMatch(home, /#docs|View docs/);
  assert.doesNotMatch(integrate, /#docs|View docs/);
  assert.match(integrate, /Partner contract/);
  assert.doesNotMatch(home, /href="\/app\/"/);
  assert.match(home, /href="https:\/\/github\.com\/ivanillka\/f-motion"/);
  assert.match(integrate, /href="\/app\/"/);
  assert.match(integrate, /href="\.\/terms\.html"/);
  const terms = await readFile(new URL("terms.html", root), "utf8");
  const privacy = await readFile(new URL("privacy.html", root), "utf8");
  assert.match(terms, /Terms of use/);
  assert.match(privacy, /Privacy notice/);
  assert.doesNotMatch(terms, /ScrollTrigger|ScrambleText/);
  assert.match(css, /\.nav-compact/);
  assert.match(css, /\.skip-link/);
  assert.match(css, /\.update-visual/);
  assert.match(css, /\.section\.story/);
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /connect-src[^;]*https:\/\/\*\.supabase\.co/);
  assert.match(headers, /connect-src[^;]*wss:\/\/\*\.supabase\.co/);
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
  for (const asset of [
    "hero-reel.jpg",
    "hero-reel.webp",
    "hero-reel-800.webp",
    "studio-ui.jpg",
    "studio-ui.webp",
    "host-diagram.jpg",
    "host-diagram.webp",
    "fmotion-agents-hero.jpg",
    "fmotion-agents-hero.webp",
    "fmotion-media-first.jpg",
    "fmotion-chat-only.jpg",
    "fmotion-og-compose.jpg"
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

test("landing CSP matches Pages and both web nginx configs", async () => {
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://*.supabase.co",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com",
    "upgrade-insecure-requests"
  ].join("; ");
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  const headerLine = headers.split("\n").find((line) => line.includes("Content-Security-Policy:"));
  assert.equal(headerLine?.replace(/^.*Content-Security-Policy:\s*/, "").trim(), policy);
  const scriptSrc = policy.match(/script-src[^;]*/)?.[0] ?? "";
  assert.equal(scriptSrc, "script-src 'self' https://static.cloudflareinsights.com");
  assert.doesNotMatch(scriptSrc, /unsafe-inline|\*/);
  assert.match(policy, /media-src 'self'/);
  assert.match(policy, /img-src 'self'/);
  for (const rel of ["../../../deploy/hetzner/nginx.conf", "../../../deploy/vps/nginx.conf"]) {
    const nginx = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.match(nginx, new RegExp(`add_header Content-Security-Policy "${policy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" always;`));
  }
  const hetzner = await readFile(new URL("../../../deploy/hetzner/nginx.conf", import.meta.url), "utf8");
  const apiServer = hetzner.split("server {")[1] ?? "";
  assert.match(apiServer, /server_name api\.f-motion\.com/);
  assert.doesNotMatch(apiServer, /Content-Security-Policy/);
  const home = await readFile(new URL("../public/web/index.html", import.meta.url), "utf8");
  const cs = await readFile(new URL("../public/web/cs/index.html", import.meta.url), "utf8");
  assert.match(home, /<script src="\.\/launch-redirect\.js"><\/script>/);
  assert.match(cs, /<script src="\.\.\/launch-redirect\.js"><\/script>/);
  assert.match(home, /<script src="\.\/demo-reel\.js"><\/script>/);
  assert.doesNotMatch(home, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(cs, /<script(?![^>]*\bsrc=)/);
});

test("scene editor is split into four accessible tabs (Style, Timing, Text, Media) with at most 4 controls each", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

  assert.match(source, /role="tablist"/);
  assert.match(source, /role="tab"/);
  assert.match(source, /role="tabpanel"/);
  assert.match(source, /aria-controls=\{`scene-panel-\$\{t\.id\}`\}/);
  assert.match(source, /aria-labelledby="scene-tab-style"/);
  assert.match(source, /aria-labelledby="scene-tab-timing"/);
  assert.match(source, /aria-labelledby="scene-tab-text"/);
  assert.match(source, /aria-labelledby="scene-tab-media"/);

  assert.match(source, /id:\s*"style",\s*label:\s*"Style"/);
  assert.match(source, /id:\s*"timing",\s*label:\s*"Timing"/);
  assert.match(source, /id:\s*"text",\s*label:\s*"Text"/);
  assert.match(source, /id:\s*"media",\s*label:\s*"Media"/);

  assert.match(source, /onKeyDown=\{handleTabKeyDown\}/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /Home/);
  assert.match(source, /End/);

  assert.match(css, /\.scene-tablist/);
  assert.match(css, /\.scene-tab-btn/);
  assert.match(css, /\.scene-tabpanel/);
  assert.match(css, /\.scene-tabpanel\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);

  assert.match(source, /scene-panel-style[\s\S]*overlay-looks[\s\S]*overlay-places[\s\S]*motion-\$\{activeScene\.id\}/);
  assert.match(source, /scene-panel-timing[\s\S]*duration-\$\{activeScene\.id\}[\s\S]*audio-\$\{activeScene\.id\}[\s\S]*Mute scene/);
  assert.match(source, /scene-panel-text[\s\S]*caption-\$\{activeScene\.id\}[\s\S]*prompt-\$\{activeScene\.id\}/);
  assert.match(source, /scene-panel-media[\s\S]*searchStock[\s\S]*openFalGenerate[\s\S]*openFalAnimate[\s\S]*Upload media/);
});

test("music catalogue credits and LICENSE.md never use U+2014", async () => {
  const { stockBeds, stockBedCredit } = await import("@f-engine/contracts");
  for (const bed of stockBeds) {
    assert.equal(stockBedCredit(bed).includes("\u2014"), false, bed.id);
    assert.equal(JSON.stringify(bed).includes("\u2014"), false, bed.id);
  }
  const license = await readFile(new URL("../public/music/LICENSE.md", import.meta.url), "utf8");
  assert.equal(license.includes("\u2014"), false);
  assert.match(license, /banger\.mp3/);
  assert.match(license, /rush\.mp3/);
  assert.match(license, /CC BY 4\.0/);
  assert.match(license, /CC0 1\.0/);
});
