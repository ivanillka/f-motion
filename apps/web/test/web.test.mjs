import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

test("required recovery, accessibility, and preview language is present", async () => {
  const source = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  for (const phrase of ["Drafts", "Continue to video plan", "Plan the video", "prepared this recommendation from your conversation", "Edit recommended video plan", "Recommended video plan", "What should this video achieve", "Who is it for", "How should the story unfold", "What tone fits best", "How fast should it feel", "Target length", "Where should visuals come from", "Pexels real stock video", "Continue to story concepts", "Choose a story approach", "Licensed visuals are matched only after you choose", "Storyboard", "Approximate composition", "Find licensed media", "Find another licensed video", "Select for scene", "Move scene", "Add scene", "Remove scene", "Generate accurate preview", "playsInline", "Older preview", "Reload latest", "Save as new project", "media not copied", "pending", "was not merged", "Reconnecting", "magic link", "Google", "Pexels", "Cancel render", "Download preview", "Accurate preview failed", "Retry", "Choose video sources", "Choose your video sources", "Real stock video", "AI video", "voice", "More providers", "More ways to create", "Locked", "Why is this locked", "Pexels stock is locked", "Connect your Pexels API key to search real stock video", "FAL generation is locked", "Open provider settings", "Settings", "Sign out", "Waiting for media inspection", "Media is still inspecting", "Connect your own Pexels API key", "F-Motion does not supply or share a Pexels key", "Connect Pexels", "Test Pexels", "Disconnect Pexels", "Connect your own FAL API-scope key", "charged directly to your FAL account", "Generation is not live yet", "F-Motion does not supply or share a FAL key", "Connect FAL", "Test connection", "Disconnect"]) assert.match(source, new RegExp(phrase));
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
  for (const unsafe of ["fengine-access-token", "/auth/v1/otp", "/authorize", "location.hash"]) {
    assert.doesNotMatch(source, new RegExp(unsafe.replace("/", "\\/")));
  }
  assert.doesNotMatch(source, /localStorage[^\n]*fal|sessionStorage[^\n]*fal|VITE_.*FAL/);
  assert.doesNotMatch(source, /localStorage[^\n]*pexels|sessionStorage[^\n]*pexels|VITE_.*PEXELS/);
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
});
