import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

interface ProbeResult {
  streams?: Array<{ codec_name?: string; codec_type?: string; width?: number; height?: number }>;
  format?: { duration?: string };
}

async function projectDurationMs(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    if (!projectId) throw new Error("project id missing");
    const response = await fetch(`/api/projects/${projectId}`);
    if (!response.ok) throw new Error(`project unavailable: ${response.status}`);
    const { project } = await response.json() as { project: { scenes: Array<{ duration_ms: number }> } };
    return project.scenes.reduce((total, scene) => total + scene.duration_ms, 0);
  });
}

interface StudioScene {
  id: string;
  order: number;
  caption: string;
  title?: string;
  motion: string;
  duration_ms: number;
  media_id?: string;
}

async function projectScenes(page: Page): Promise<StudioScene[]> {
  return page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    if (!projectId) throw new Error("project id missing");
    const response = await fetch(`/api/projects/${projectId}`);
    if (!response.ok) throw new Error(`project unavailable: ${response.status}`);
    const { project } = await response.json() as { project: { scenes: StudioScene[] } };
    return project.scenes;
  });
}

/** Type of every attached asset, in scene order. */
async function sceneMediaTypes(page: Page): Promise<Array<{ order: number; type: string }>> {
  return page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    if (!projectId) throw new Error("project id missing");
    const found = await fetch(`/api/projects/${projectId}`);
    if (!found.ok) throw new Error(`project unavailable: ${found.status}`);
    const { project } = await found.json() as { project: { scenes: Array<{ order: number; media_id?: string }> } };
    const types: Array<{ order: number; type: string }> = [];
    for (const scene of project.scenes) {
      if (!scene.media_id) continue;
      const response = await fetch(`/api/projects/${projectId}/media/${scene.media_id}`);
      if (!response.ok) throw new Error(`media unavailable: ${response.status}`);
      const media = await response.json() as { detected?: { type: string } };
      types.push({ order: scene.order, type: media.detected?.type ?? "" });
    }
    return types;
  });
}

/** Frame size from a JPEG SOF marker, i.e. what the browser really uploaded. */
function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  for (let at = 2; at + 9 < bytes.length;) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    }
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2) return undefined;
    at += 2 + length;
  }
  return undefined;
}

async function expectRenderedProject(
  rendered: APIResponse,
  expectedDurationMs: number,
  size: { width: number; height: number } = { width: 540, height: 960 }
): Promise<void> {
  expect(rendered.ok()).toBeTruthy();
  expect(rendered.headers()["content-type"]).toContain("video/mp4");
  const body = await rendered.body();
  expect(body.length).toBeGreaterThan(1000);
  const directory = await mkdtemp(join(tmpdir(), "fengine-e2e-probe-"));
  const path = join(directory, "render.mp4");
  try {
    await writeFile(path, body);
    const probe = JSON.parse(execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,width,height:format=duration",
      "-of", "json",
      path
    ], { encoding: "utf8" })) as ProbeResult;
    const video = probe.streams?.find(({ codec_type: type }) => type === "video");
    const audio = probe.streams?.find(({ codec_type: type }) => type === "audio");
    const durationMs = Number(probe.format?.duration) * 1000;
    expect(video).toMatchObject({ codec_name: "h264", width: size.width, height: size.height });
    expect(audio).toMatchObject({ codec_name: "aac" });
    expect(durationMs).toBeGreaterThan(500);
    expect(Math.abs(durationMs - expectedDurationMs)).toBeLessThan(250);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
}


async function nextBriefChoice(page: Page) {
  return page.locator(".brief-chat-choices button:not(.is-primary)").first();
}

/** Answers offered by the current brief question, without the primary action. */
function briefChoiceLabels(page: Page) {
  return page.locator(".brief-chat-choices button:not(.is-primary)");
}

/** Clicks the audience and length answers a topic alone cannot give. */
async function answerBriefSetup(
  page: Page,
  answers: readonly string[] = ["General viewers", "About 30 seconds"]
): Promise<void> {
  for (const answer of answers) {
    const choice = page.getByRole("button", { name: answer, exact: true });
    await expect(choice).toBeVisible();
    await choice.click();
  }
}

async function describeVideo(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message F-Motion").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  for (let step = 0; step < 4; step += 1) {
    if (await page.getByRole("heading", { name: "Storyboard" }).isVisible()) return;
    const choice = await nextBriefChoice(page);
    if (!await choice.isVisible()) break;
    await choice.click();
  }
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
}

async function briefAdvance(page: Page): Promise<"storyboard" | "own" | "choices"> {
  const storyboard = page.getByRole("heading", { name: "Storyboard" });
  const own = page.getByRole("button", { name: "Use my photos", exact: true });
  const choice = await nextBriefChoice(page);
  await expect.poll(async () => {
    if (await storyboard.isVisible()) return "storyboard";
    if (await own.isVisible()) return "own";
    if (await choice.isVisible()) return "choices";
    return "wait";
  }, { timeout: 15_000 }).not.toBe("wait");
  if (await storyboard.isVisible()) return "storyboard";
  if (await own.isVisible()) return "own";
  return "choices";
}

async function sayOwnMedia(page: Page): Promise<void> {
  if (await page.getByRole("heading", { name: "Storyboard" }).isVisible()) return;
  const own = page.getByRole("button", { name: "Use my photos", exact: true });
  if (await own.isVisible()) {
    await own.click();
    return;
  }
  const box = page.getByLabel("Message F-Motion");
  if (!await box.isVisible()) return;
  await box.fill("Use my photos");
  await page.getByRole("button", { name: "Send" }).click();
}

async function briefWithOwnStill(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message F-Motion").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  let pickedOwn = false;
  for (let step = 0; step < 6; step += 1) {
    const next = await briefAdvance(page);
    if (next === "storyboard") return;
    if (next === "own") {
      await page.getByRole("button", { name: "Use my photos", exact: true }).click();
      pickedOwn = true;
      break;
    }
    await (await nextBriefChoice(page)).click();
  }
  if (!pickedOwn) await sayOwnMedia(page);
  if (await page.getByRole("heading", { name: "Storyboard" }).isVisible()) return;
  await page.locator("section.create-brief input[type=file]").setInputFiles("apps/worker/test/fixtures/still.jpg");
  for (let step = 0; step < 4; step += 1) {
    const next = await briefAdvance(page);
    if (next === "storyboard") return;
    if (next !== "choices") break;
    await (await nextBriefChoice(page)).click();
  }
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
}

async function createStoryboard(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
}

function mediaFileInput(page: Page) {
  return page.locator('input[type="file"][accept*="image/jpeg"]');
}

async function attachFixtureToScene(page: Page, sceneNumber: number): Promise<void> {
  await page.getByRole("button", { name: `Edit scene ${sceneNumber}` }).click();
  const input = mediaFileInput(page);
  await input.setInputFiles([]);
  await input.setInputFiles("apps/worker/test/fixtures/still.jpg");
  await expect(page.getByRole("status").filter({ hasText: "Media attached to this scene" })).toBeVisible();
}

/** Interactive studio controls whose box reaches into the fixed phone dock. */
async function controlsUnderPhoneDock(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const dock = document.querySelector(".app-dock");
    if (!dock) return ["app-dock is missing"];
    const dockBox = dock.getBoundingClientRect();
    if (dockBox.height < 1) return [];
    const under: string[] = [];
    for (const node of document.querySelectorAll(".app-stage button, .app-stage input, .app-stage textarea, .app-stage a[href]")) {
      if (node.closest(".app-dock")) continue;
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      if (box.top >= dockBox.bottom || box.bottom <= dockBox.top) continue;
      const label = (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      under.push(`${node.tagName.toLowerCase()}:${label || "(unnamed)"}`);
    }
    return under;
  });
}

async function scrollStudioToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const node of document.querySelectorAll(".app-shell, .app-stage")) node.scrollTop = node.scrollHeight;
  });
}

/**
 * Phone screens keep growing after a step change (fonts, decoded media, the live
 * cut), so re-scroll and re-measure until the tail stops moving instead of
 * reading a stale, half-scrolled layout.
 */
async function expectNothingUnderPhoneDock(page: Page, message: string): Promise<void> {
  await expect.poll(async () => {
    await scrollStudioToEnd(page);
    return controlsUnderPhoneDock(page);
  }, { message, timeout: 10_000 }).toEqual([]);
}

test("E2E worker rejects empty snapshots and missing fixture mappings", async ({ request }) => {
  const job = {
    jobId: "00000000-0000-4000-8000-000000000001",
    projectId: "project",
    revision: 0,
    snapshot: {
      schema_version: 1,
      id: "project",
      owner_id: "owner",
      revision: 0,
      brief: { purpose: "Fixture", audience: "Fixture", tone: "Neutral" },
      scenes: []
    },
    mediaInputs: {},
    kind: "preview",
    renderProfile: { width: 540, height: 960 }
  };
  const empty = await request.post("http://127.0.0.1:43141/jobs", { data: job });
  expect(empty.status()).toBe(400);

  const missing = await request.post("http://127.0.0.1:43141/jobs", {
    data: {
      ...job,
      jobId: "00000000-0000-4000-8000-000000000002",
      snapshot: {
        ...job.snapshot,
        scenes: [{
          id: "scene",
          order: 0,
          caption: "Fixture",
          duration_ms: 3000,
          focal_x: 0.5,
          focal_y: 0.5,
          motion: "none",
          audio_level: 1,
          ducking: false,
          media_id: "missing"
        }]
      }
    }
  });
  expect(missing.status()).toBe(400);
});

test("locked provider actions explain the blocker and next action", async ({ page }) => {
  await page.route("**/api/providers/pexels/credential", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: "pexels", connected: false }) });
    } else {
      await route.continue();
    }
  });
  await signIn(page);
  await page.getByRole("button", { name: /Pexels Real stock video · locked/ }).click();
  await expect(page.getByRole("heading", { name: "Pexels stock is locked" })).toBeVisible();
  await expect(page.getByText("Connect your Pexels API key to search real stock video.")).toBeVisible();
  await page.getByRole("button", { name: "Open provider settings" }).click();
  await expect(page.getByRole("heading", { name: "Choose your video sources" })).toBeVisible();
  await page.getByRole("button", { name: "Why is this locked?" }).first().click();
  await expect(page.getByRole("heading", { name: "Pexels stock is locked" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
});

test("own media is glanced locally before remaining Create questions", async ({ page }) => {
  await page.route("https://e2e-storage.invalid/**", (route) =>
    route.fulfill({ status: 200, body: "" }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.locator("section.create-brief input[type=file]").setInputFiles("apps/worker/test/fixtures/still.jpg");
  await expect(page.getByText(/I looked at 1 photo/i)).toBeVisible();
  const makeNow = page.getByRole("button", { name: "Make my storyboard now", exact: true });
  await expect(makeNow).toBeVisible();
  await expect(page.locator(".brief-chat-choices button").first()).toHaveText("Make my storyboard now");
  await expect(page.locator(".brief-chat-choices button.is-primary").first()).toHaveText("Make my storyboard now");
  await expect(page.getByRole("heading", { name: "Storyboard" })).toHaveCount(0);
  // The first action after uploads skips the remaining questions and lands on
  // the storyboard with the photo already attached to scene 1.
  await makeNow.click();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Media attached to this scene" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit scene 1" }).locator("img")).toBeVisible();
});

test("upload journey, natural conflict recovery, render, and download", async ({ page }) => {
  await page.route("https://e2e-storage.invalid/**", (route) =>
    route.fulfill({ status: 200, body: "" }));
  await page.setViewportSize({ width: 320, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("Launch a product for small teams");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
  await page.getByRole("button", { name: "Create new video" }).click();
  await expect(page.getByLabel("Message F-Motion")).toHaveValue("Launch a product for small teams");
  await briefWithOwnStill(page, "Launch a product for small teams");
  await createStoryboard(page);
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Media attached" })).toBeVisible();
  for (const sceneNumber of [2, 3, 4]) await attachFixtureToScene(page, sceneNumber);

  const projectId = await page.evaluate(() => localStorage.getItem("fengine-project"));
  expect(projectId).toBeTruthy();
  await page.evaluate(async (id) => {
    const found = await fetch(`/api/projects/${id}`);
    const { project } = await found.json();
    const response = await fetch(`/api/projects/${id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: crypto.randomUUID(),
        base_revision: project.revision,
        client_timestamp: new Date().toISOString(),
        kind: "update_scene",
        payload: { scene: { ...project.scenes[0], caption: `${project.scenes[0].caption}!` } }
      })
    });
    if (!response.ok) throw new Error(`conflict setup failed: ${response.status}`);
  }, projectId);
  await page.getByLabel("Scene 4 motion").selectOption("push");
  await expect(page.getByRole("heading", { name: "Newer changes exist" })).toBeVisible();
  await expect(page.getByText(/pending scene edits on scene 4 was not merged/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as new project" })).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();

  await expect(page.getByRole("button", { name: /Play preview|Pause preview/ })).toBeVisible();
  await expect(page.getByLabel(/Live preview/)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Play progress" })).toBeVisible();

  await page.getByRole("button", { name: "Export video" }).click();
  await expect(page.getByRole("heading", { name: "Final export" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "complete · final export" })).toBeVisible({ timeout: 90_000 });
  const finalDownload = page.getByRole("link").filter({ has: page.getByRole("button", { name: "Download export" }) });
  await expect(page.getByRole("button", { name: "Download export" })).toBeEnabled();
  await expect(page.getByText("1080×1920")).toBeVisible();
  const finalHref = await finalDownload.getAttribute("href");
  expect(finalHref).toMatch(/^http:\/\/127\.0\.0\.1:43141\/downloads\//);
  const finalRendered = await page.request.get(finalHref!);
  await expectRenderedProject(finalRendered, await projectDurationMs(page), { width: 1080, height: 1920 });
});

test("licensed stock journey auto-matches distinct scenes then renders", async ({ page }) => {
  await page.route("https://e2e-images.invalid/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#333"/></svg>'
  }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await describeVideo(page, "A calm studio introduction");
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(5);
  await expect(page.getByText(/The story begins\.|Calm studio introduction/i).first()).toBeVisible();
  await expect(page.getByRole("status").filter({
    hasText: /Licensed media attached for every scene|scenes have media/
  })).toBeVisible({ timeout: 60_000 });

  const attached = await page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    const { project } = await (await fetch(`/api/projects/${projectId}`)).json();
    const creators = await Promise.all(project.scenes.map(async ({ media_id }) => {
      if (!media_id) return null;
      const media = await (await fetch(`/api/projects/${projectId}/media/${media_id}`)).json();
      return media.attribution?.creator ?? null;
    }));
    return { sceneCount: project.scenes.length, creators };
  });
  expect(attached.sceneCount).toBe(5);
  expect(attached.creators.every(Boolean)).toBeTruthy();
  expect(new Set(attached.creators).size).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "Edit scene 1" }).click();
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByRole("button", { name: "Find another licensed video for scene 1" }).click();
  await expect(page.locator(".fit-badge").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Select for scene 1" })).toHaveCount(3);
  await page.getByRole("article").filter({ hasText: "Fixture Two With A Long Name" })
    .getByRole("button", { name: "Select for scene 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "video by Fixture Two With A Long Name on Pexels" })).toBeVisible();

  await page.getByRole("button", { name: "Edit scene 5" }).click();
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByLabel("Scene 5 caption").fill("Closing beat for the guided editor");
  await page.getByLabel("Scene 5 caption").press("Tab");
  await page.getByRole("button", { name: "Edit scene 2" }).click();
  await page.getByRole("button", { name: "Move scene 2 earlier" }).click();
  await expect(page.getByRole("button", { name: "Edit scene 1", pressed: true })).toBeVisible();

  await expect(page.getByRole("button", { name: /Play preview|Pause preview/ })).toBeVisible();
  await expect(page.getByLabel(/Live preview/)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Play progress" })).toBeVisible();
  const editedCaption = page.getByLabel("Scene 1 caption");
  await editedCaption.fill("Updated after preview");
  await editedCaption.press("Tab");
  await expect(editedCaption).toHaveValue("Updated after preview");
  await expect(page.getByLabel(/Live preview/).getByText("Updated after preview")).toBeVisible();
  await page.getByRole("button", { name: "Back to drafts" }).click();
  await page.getByRole("button").filter({ hasText: "A calm studio introduction" }).click();
  await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(5);

  const storedSessionValues = await page.evaluate(() =>
    Object.values(sessionStorage));
  expect(storedSessionValues).not.toContainEqual(expect.stringMatching(/^local-demo-/));
  await expect(page.locator("body")).not.toContainText(/local-demo-|access_token/i);
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Shape a vertical video" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Shape a vertical video" })).toBeVisible();
});

test("FAL still generation quotes, confirms, and attaches only after review", async ({ page }) => {
  await page.route("https://e2e-storage.invalid/**", (route) =>
    route.fulfill({ status: 200, body: "" }));
  await page.route("https://e2e-images.invalid/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#555"/></svg>'
    }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await briefWithOwnStill(page, "A fictional lighthouse no camera has recorded");
  await createStoryboard(page);
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Media attached" })).toBeVisible();
  for (const sceneNumber of [2, 3, 4]) await attachFixtureToScene(page, sceneNumber);

  await page.getByRole("button", { name: "Edit scene 1" }).click();
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByRole("button", { name: "Generate AI image for scene 1" }).click();
  await expect(page.getByRole("heading", { name: "Generate AI image for scene 1" })).toBeVisible();
  await page.getByLabel("Image prompt").fill("quiet lighthouse at dusk, soft fog, cinematic");
  await page.getByRole("button", { name: "Get FAL price" }).click();
  await expect(page.getByText(/estimated total USD 0\.003/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate one image" })).toBeEnabled();
  await page.getByRole("button", { name: "Generate one image" }).click();
  await expect(page.getByRole("status").filter({ hasText: /AI still ready/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Generate AI image for scene 1" }).click();
  await expect(page.getByRole("button", { name: "Use for scene 1" })).toBeVisible();
  await expect(page.getByText("AI-generated with FAL").first()).toBeVisible();
  const mediaIdBefore = await page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    const { project } = await (await fetch(`/api/projects/${projectId}`)).json();
    return project.scenes.find((scene) => scene.order === 0)?.media_id ?? null;
  });
  await page.getByRole("button", { name: "Use for scene 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: /AI-generated with FAL/i })).toBeVisible();
  const mediaIdAfter = await page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    const { project } = await (await fetch(`/api/projects/${projectId}`)).json();
    return project.scenes.find((scene) => scene.order === 0)?.media_id ?? null;
  });
  expect(mediaIdAfter).toBeTruthy();
  expect(mediaIdAfter).not.toEqual(mediaIdBefore);

  await expect(page.getByRole("button", { name: /Play preview|Pause preview/ })).toBeVisible();
  await expect(page.getByLabel(/Live preview/)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Play progress" })).toBeVisible();
});

async function projectSoundtrack(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    if (!projectId) throw new Error("project id missing");
    const response = await fetch(`/api/projects/${projectId}`);
    if (!response.ok) throw new Error(`project unavailable: ${response.status}`);
    const { project } = await response.json() as {
      project: { brief: { soundtrack?: { kind?: string; stock_id?: string; bpm?: number } } };
    };
    const soundtrack = project.brief.soundtrack;
    return soundtrack ? `${soundtrack.kind}:${soundtrack.stock_id}:${soundtrack.bpm}` : "none";
  });
}

test("picking a stock bed writes its tempo and a typed tempo stays put", async ({ page }) => {
  await page.route("https://e2e-storage.invalid/**", (route) =>
    route.fulfill({ status: 200, body: "" }));
  await page.route("https://e2e-images.invalid/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#333"/></svg>'
    }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await describeVideo(page, "A calm studio introduction");
  await createStoryboard(page);

  const dockToggle = page.locator(".music-dock > summary").last();
  const beds = page.getByRole("group", { name: "Stock music beds" });
  const tempo = page.getByLabel("BPM", { exact: true });
  const catalogue: Array<[string, number]> = [
    ["Funkorama", 101],
    ["Space Fighter Loop", 95],
    ["Dreamy Flashback", 110],
    ["Easy Lemon", 82],
    ["Wallpaper", 93],
    ["Hot Swing", 144],
    ["Banger", 170],
    ["Hyper Ultra-Racing", 168]
  ];

  await dockToggle.click();
  for (const [title, bpm] of catalogue) {
    await expect(beds.getByRole("button", { name: new RegExp(`^${title}`) })).toContainText(`${bpm} BPM`);
  }

  await beds.getByRole("button", { name: /^Funkorama/ }).click();
  // A pick closes the dock, so reopen it before reading the tempo box.
  await dockToggle.click();
  await expect(tempo).toHaveValue("101");
  await expect.poll(() => projectSoundtrack(page)).toBe("stock:pulse:101");

  await tempo.fill("150");
  await tempo.press("Tab");
  await expect(tempo).toHaveValue("150");
  await expect.poll(() => projectSoundtrack(page)).toBe("stock:pulse:150");
  // The saved tempo must not snap the box back to the catalogue value.
  await dockToggle.click();
  await dockToggle.click();
  await expect(tempo).toHaveValue("150");

  await beds.getByRole("button", { name: /^Dreamy Flashback/ }).click();
  await dockToggle.click();
  await expect(tempo).toHaveValue("110");
  await expect.poll(() => projectSoundtrack(page)).toBe("stock:air:110");
});

test("the phone dock leaves the Create composer and studio footers reachable", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 664 });
  await signIn(page);
  // Chromium reports env(safe-area-inset-bottom) as 0 on every platform, so the
  // studio exposes the inset as --safe-bottom; 34px is the iOS home indicator.
  await page.addStyleTag({ content: ":root { --safe-bottom: 34px; }" });
  const dock = page.locator(".app-dock");
  await expect(dock).toBeVisible();
  const dockBox = await dock.boundingBox();
  expect(dockBox).not.toBeNull();
  expect((dockBox?.height ?? 0)).toBeCloseTo(98, 0);
  expect((dockBox?.y ?? 0) + (dockBox?.height ?? 0)).toBeCloseTo(664, 0);
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
  await expectNothingUnderPhoneDock(page, "Drafts keeps its dock and safe-area padding");

  await dock.getByRole("button", { name: "Create" }).click();
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeVisible();
  const composerBox = await page.locator(".brief-composer").boundingBox();
  expect(composerBox).not.toBeNull();
  expect((composerBox?.y ?? 0) + (composerBox?.height ?? 0)).toBeLessThanOrEqual(dockBox?.y ?? 0);
  const sendBox = await send.boundingBox();
  expect(sendBox).not.toBeNull();
  expect((sendBox?.y ?? 0) + (sendBox?.height ?? 0)).toBeLessThanOrEqual(dockBox?.y ?? 0);
  // A tap on Send must land on Send, not on the dock above it.
  const tapped = await page.evaluate(([x, y]) =>
    document.elementFromPoint(x, y)?.closest("button")?.textContent?.trim() ?? "",
  [(sendBox?.x ?? 0) + (sendBox?.width ?? 0) / 2, (sendBox?.y ?? 0) + (sendBox?.height ?? 0) / 2]);
  expect(tapped).toBe("Send");
  expect(await controlsUnderPhoneDock(page), "the pinned composer stays above the dock").toEqual([]);
  await expectNothingUnderPhoneDock(page, "scrolled Create keeps the whole composer clear");
  await expect(page.getByLabel("Message F-Motion")).toBeVisible();

  await briefWithOwnStill(page, "A calm launch teaser for a small team");
  await createStoryboard(page);
  await expectNothingUnderPhoneDock(page, "Storyboard keeps its dock and safe-area padding");
  // A block-level phone shell must not take its width from the editor's
  // min-content, which widened the shell to 474px at 390px and clipped the studio.
  const widths = await page.evaluate(() => ({
    shell: document.querySelector(".app-shell")?.getBoundingClientRect().width ?? 0,
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth
  }));
  expect(widths.shell).toBeLessThanOrEqual(widths.viewport + 0.5);
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  for (const screen of ["Drafts", "Settings"]) {
    await dock.getByRole("button", { name: screen }).click();
    await expectNothingUnderPhoneDock(page, `${screen} keeps its dock and safe-area padding`);
  }
});

test("FAL image-to-video quotes, confirms, and attaches only after review", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("https://e2e-storage.invalid/**", (route) =>
    route.fulfill({ status: 200, body: "" }));
  await page.route("https://e2e-images.invalid/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#555"/></svg>'
    }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await briefWithOwnStill(page, "Animate a portrait still of a quiet harbor");
  await createStoryboard(page);
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Media attached" })).toBeVisible();
  for (const sceneNumber of [2, 3, 4]) await attachFixtureToScene(page, sceneNumber);

  await page.getByRole("button", { name: "Edit scene 1" }).click();
  await page.getByRole("tab", { name: "Media" }).click();
  await page.getByRole("button", { name: "Animate this image for scene 1" }).click();
  await expect(page.getByRole("heading", { name: "Animate image for scene 1" })).toBeVisible();
  await page.getByLabel("Motion prompt").fill("gentle camera drift over the harbor");
  await page.getByRole("button", { name: "Get FAL price" }).click();
  await expect(page.getByText(/estimated total USD 0\.19/i)).toBeVisible();
  await page.getByRole("button", { name: "Generate one 6-second video" }).click();
  await expect(page.getByRole("status").filter({ hasText: /AI video ready/i })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Animate this image for scene 1" }).click();
  await expect(page.getByRole("button", { name: "Use video for scene 1" })).toBeVisible();
  await page.getByRole("button", { name: "Use video for scene 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: /AI-generated FAL video/i })).toBeVisible();

  await expect(page.getByRole("button", { name: /Play preview|Pause preview/ })).toBeVisible();
  await expect(page.getByLabel(/Live preview/)).toBeVisible();
  await expect(page.getByRole("slider", { name: "Play progress" })).toBeVisible();
});

test("scene editor tabs switch via click and keyboard, show at most 4 controls, and persist edits", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await briefWithOwnStill(page, "A calm launch teaser for a small team");
  await createStoryboard(page);
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Edit scene 1" }).click();

  const tablist = page.getByRole("tablist", { name: "Scene 1 settings" });
  await expect(tablist).toBeVisible();

  const styleTab = page.getByRole("tab", { name: "Style" });
  const timingTab = page.getByRole("tab", { name: "Timing" });
  const textTab = page.getByRole("tab", { name: "Text" });
  const mediaTab = page.getByRole("tab", { name: "Media" });

  await expect(styleTab).toHaveAttribute("aria-selected", "true");
  await expect(timingTab).toHaveAttribute("aria-selected", "false");
  await expect(textTab).toHaveAttribute("aria-selected", "false");
  await expect(mediaTab).toHaveAttribute("aria-selected", "false");

  // Style panel is visible and active
  const stylePanel = page.locator("#scene-panel-style");
  await expect(stylePanel).toBeVisible();
  await expect(stylePanel.getByRole("group", { name: "Overlay look" })).toBeVisible();
  await expect(stylePanel.getByRole("group", { name: "Overlay place" })).toBeVisible();
  await expect(page.getByLabel("Scene 1 motion")).toBeVisible();

  // Edit in Style tab: change motion to Zoom
  await page.getByLabel("Scene 1 motion").selectOption("zoom");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  // Switch tab via keyboard ArrowRight
  await styleTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(timingTab).toHaveAttribute("aria-selected", "true");
  const timingPanel = page.locator("#scene-panel-timing");
  await expect(timingPanel).toBeVisible();
  await expect(stylePanel).toBeHidden();

  // Timing panel has exactly 3 controls (Seconds, clip volume, Mute button)
  await expect(timingPanel.locator("input, button")).toHaveCount(3);
  await page.getByLabel("Seconds").fill("4.5");
  await page.getByLabel("Seconds").press("Tab");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  // Switch to Text tab via click
  await textTab.click();
  await expect(textTab).toHaveAttribute("aria-selected", "true");
  const textPanel = page.locator("#scene-panel-text");
  await expect(textPanel).toBeVisible();
  await expect(timingPanel).toBeHidden();

  // Text panel has 2 controls (Caption, Search)
  await expect(textPanel.locator("input, textarea")).toHaveCount(2);
  const captionInput = page.getByLabel("Scene 1 caption");
  await captionInput.fill("Updated scene caption for tab test");
  await captionInput.press("Tab");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  // Switch to Media tab via keyboard End key
  await textTab.focus();
  await page.keyboard.press("End");
  await expect(mediaTab).toHaveAttribute("aria-selected", "true");
  const mediaPanel = page.locator("#scene-panel-media");
  await expect(mediaPanel).toBeVisible();
  await expect(textPanel).toBeHidden();

  // Media panel visible controls <= 4
  const visibleMediaButtons = await mediaPanel.locator("button:visible").count();
  expect(visibleMediaButtons).toBeLessThanOrEqual(4);

  // Switch back to Style and verify motion is still zoom
  await styleTab.click();
  await expect(page.getByLabel("Scene 1 motion")).toHaveValue("zoom");

  // Switch to Text and verify caption is still saved
  await textTab.click();
  await expect(page.getByLabel("Scene 1 caption")).toHaveValue("Updated scene caption for tab test");
});


test("photos to reel builds beat snapped scenes with a title, an end card, and fitted stills", async ({ page }) => {
  test.setTimeout(180_000);
  // The e2e storage is a stub, so the upload itself is where the fitted size shows.
  const uploaded: Array<{ width: number; height: number }> = [];
  await page.route("https://e2e-storage.invalid/**", async (route) => {
    const bytes = route.request().postDataBuffer();
    const size = bytes ? jpegSize(bytes) : undefined;
    if (size) uploaded.push(size);
    await route.fulfill({ status: 200, body: "" });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await briefWithOwnStill(page, "Photos from a road trip");
  await createStoryboard(page);

  const directory = await mkdtemp(join(tmpdir(), "fengine-photo-reel-"));
  try {
    const wide = join(directory, "wide-shoot.jpg");
    execFileSync("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "color=c=0x2f6f8f:s=5000x1000",
      "-frames:v", "1", "-q:v", "3", wide
    ]);

    const toggle = page.getByRole("button", { name: "Photos to reel", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator("#photos-to-reel-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("status")).toHaveText("Pick at least one photo to see the beat layout.");
    // The picker clears its own value, so the count has to stay on screen.
    await expect(panel.locator("#photos-to-reel-picked")).toHaveText("No photos picked yet");

    // The wide still is over MEDIA_MAX_WIDTH, so the studio has to fit it.
    await panel.locator("#photos-to-reel-files").setInputFiles([
      { name: "wide-shoot.jpg", mimeType: "image/jpeg", buffer: await readFile(wide) },
      { name: "still.jpg", mimeType: "image/jpeg", buffer: await readFile("apps/worker/test/fixtures/still.jpg") }
    ]);
    await panel.locator("#photos-to-reel-bpm").fill("120");
    await panel.locator("#photos-to-reel-pattern").fill("2,3");
    await panel.locator("#photos-to-reel-title").fill("Summer trip");
    await panel.locator("#photos-to-reel-end-card").fill("Follow for part two");
    // Two photos plus the end card: 2 + 3 + 2 beats at 120 BPM is 3.5 seconds.
    await expect(panel.getByRole("status")).toHaveText(
      "3 shots · 0:03 at 120 BPM · beats 2, 3 · zoom, zoom_out, push");

    // The brief still went through the same stub, so the reel uploads start here.
    const briefUploads = uploaded.length;
    await panel.getByRole("button", { name: "Build reel" }).click();
    await expect(page.getByRole("status").filter({
      hasText: "Photo reel built: 3 shots at 120 BPM, title on shot one and the end card last."
    })).toBeVisible({ timeout: 120_000 });
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(3);

    const scenes = await projectScenes(page);
    // One scene per photo plus the end card, alternating the photo reel motions.
    expect(scenes.map((scene) => scene.motion)).toEqual(["zoom", "zoom_out", "push"]);
    // Every cut sits on the 120 BPM grid: 2, 3, and 2 beats at 500 ms.
    expect(scenes.map((scene) => scene.duration_ms)).toEqual([1000, 1500, 1000]);
    expect(scenes[0]?.title).toBe("Summer trip");
    expect(scenes[2]?.caption).toBe("Follow for part two");
    expect(scenes.slice(1).every((scene) => !scene.title)).toBe(true);

    const sizes = await sceneMediaTypes(page);
    // Both photos reach their own scene as ready JPEGs.
    expect(sizes).toEqual([
      { order: 0, type: "image/jpeg" },
      { order: 1, type: "image/jpeg" }
    ]);
    // The 5000px still is fitted before upload, the 64px one is sent untouched.
    expect(uploaded.slice(briefUploads)).toEqual([
      { width: 4096, height: 819 },
      { width: 64, height: 64 }
    ]);

    // The new motion stays editable after the build, so a reviewer can flip a shot back.
    await page.getByRole("button", { name: "Edit scene 2" }).click();
    await expect(page.getByLabel("Scene 2 motion")).toHaveValue("zoom_out");
    await expect(page.locator('select[aria-label="Scene 2 motion"] option[value="zoom_out"]')).toHaveText("Zoom out");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("photos to reel stays usable on a 390px phone", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("https://e2e-storage.invalid/**", (route) =>
    route.fulfill({ status: 200, body: "" }));
  await page.setViewportSize({ width: 390, height: 664 });
  await signIn(page);
  await page.addStyleTag({ content: ":root { --safe-bottom: 34px; }" });
  await page.locator(".app-dock").getByRole("button", { name: "Create" }).click();
  await briefWithOwnStill(page, "A calm launch teaser for a small team");
  await createStoryboard(page);

  await page.getByRole("button", { name: "Photos to reel", exact: true }).click();
  const panel = page.locator("#photos-to-reel-panel");
  await expect(panel).toBeVisible();
  for (const field of ["files", "bpm", "pattern", "title", "end-card"]) {
    await expect(page.locator(`#photos-to-reel-${field}`)).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Build reel" })).toBeDisabled();

  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    panel: document.querySelector("#photos-to-reel-panel")?.getBoundingClientRect().width ?? 0
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.panel).toBeLessThanOrEqual(widths.viewport);
  await expectNothingUnderPhoneDock(page, "photos to reel keeps its controls clear of the dock");
});

test("photos to reel takes 23 photos as 24 shots and stops one photo before the storyboard cap", async ({ page }) => {
  test.setTimeout(300_000);
  // The e2e storage is a stub, so uploads only need to answer 200.
  await page.route("https://e2e-storage.invalid/**", (route) => route.fulfill({ status: 200, body: "" }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await briefWithOwnStill(page, "Photos from a long weekend");
  await createStoryboard(page);

  const directory = await mkdtemp(join(tmpdir(), "fengine-photo-cap-"));
  try {
    // Distinct sizes and colours keep every still its own upload.
    const photos: string[] = [];
    for (let index = 0; index < 32; index += 1) {
      const path = join(directory, `photo-${String(index + 1).padStart(2, "0")}.jpg`);
      const size = 48 + index * 3;
      const colour = (0x204060 + index * 0x040404).toString(16).slice(-6);
      execFileSync("ffmpeg", [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", `color=c=0x${colour}:s=${size}x${size}`,
        "-frames:v", "1", "-q:v", "5", path
      ]);
      photos.push(path);
    }

    await page.getByRole("button", { name: "Photos to reel", exact: true }).click();
    const panel = page.locator("#photos-to-reel-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("label[for=photos-to-reel-files]")).toContainText("up to 31");
    const files = panel.locator("#photos-to-reel-files");
    const build = panel.getByRole("button", { name: "Build reel" });

    // 32 photos would need 33 shots, one more than a reel holds.
    await files.setInputFiles(photos);
    await expect(panel.getByRole("status")).toHaveText("Pick up to 31 photos. The last shot is the end card.");
    await expect(panel.locator("#photos-to-reel-picked")).toHaveText("32 photos picked");
    await expect(build).toBeDisabled();

    // 23 photos plus the end card is the 24 shot reel this used to refuse.
    await files.setInputFiles(photos.slice(0, 23));
    await expect(panel.locator("#photos-to-reel-picked")).toHaveText("23 photos picked");
    await panel.locator("#photos-to-reel-bpm").fill("174");
    await panel.locator("#photos-to-reel-pattern").fill("2,3,8");
    await panel.locator("#photos-to-reel-title").fill("Long weekend");
    await panel.locator("#photos-to-reel-end-card").fill("Follow for part two");
    await expect(panel.getByRole("status")).toHaveText(
      "24 shots · 0:35 at 174 BPM · beats 2, 3, 8 · zoom, zoom_out, push");
    await expect(build).toBeEnabled();
    await build.click();
    await expect(page.getByRole("status").filter({
      hasText: "Photo reel built: 24 shots at 174 BPM, title on shot one and the end card last."
    })).toBeVisible({ timeout: 240_000 });

    const editScenes = page.getByRole("button", { name: /^Edit scene \d+$/ });
    await expect(editScenes).toHaveCount(24);
    const scenes = await projectScenes(page);
    expect(scenes).toHaveLength(24);
    expect(scenes.map((scene) => scene.order)).toEqual(Array.from({ length: 24 }, (_, order) => order));
    // 104 beats at 174 BPM on the 30 fps grid is 1076 frames, i.e. 35.87 seconds.
    const totalMs = scenes.reduce((total, scene) => total + scene.duration_ms, 0);
    expect(totalMs).toBeGreaterThan(35_800);
    expect(totalMs).toBeLessThan(35_900);
    expect(scenes[0]?.title).toBe("Long weekend");
    expect(scenes[23]?.caption).toBe("Follow for part two");
    expect(scenes.slice(1).every((scene) => !scene.title)).toBe(true);

    // The longer storyboard still fits a phone and a desktop: the strip scrolls
    // inside its own box instead of pushing the page sideways.
    for (const [width, height] of [[390, 664], [1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      const layout = await page.evaluate(() => {
        const strip = document.querySelector(".scene-strip");
        return {
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          stripBox: strip ? Math.round(strip.getBoundingClientRect().width) : 0,
          stripScrolls: strip ? strip.scrollWidth > strip.clientWidth : false
        };
      });
      expect(layout.document, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(layout.viewport);
      expect(layout.stripBox, `storyboard strip stays inside ${width}px`).toBeLessThanOrEqual(layout.viewport);
      // Under 980px the strip is a horizontal row, so 24 shots scroll inside it.
      if (width < 980) {
        expect(layout.stripScrolls, `24 shots scroll inside the strip at ${width}px`).toBe(true);
      }
      await expect(editScenes).toHaveCount(24);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the storyboard fills to 32 scenes and then stops adding", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("https://e2e-storage.invalid/**", (route) => route.fulfill({ status: 200, body: "" }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await briefWithOwnStill(page, "A calm launch teaser for a small team");
  await createStoryboard(page);

  const addScene = page.getByRole("button", { name: "Add scene", exact: true });
  const editScenes = page.getByRole("button", { name: /^Edit scene \d+$/ });
  const start = await editScenes.count();
  expect(start).toBeGreaterThan(0);
  expect(start).toBeLessThan(32);
  for (let count = start; count < 32; count += 1) {
    await addScene.click();
    await expect(editScenes).toHaveCount(count + 1);
  }
  await expect(addScene).toBeDisabled();
  const scenes = await projectScenes(page);
  expect(scenes).toHaveLength(32);
  expect(scenes.map((scene) => scene.order)).toEqual(Array.from({ length: 32 }, (_, order) => order));
});

test("the pictures question offers the connected sources, not a Pexels-only list", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  await expect(briefChoiceLabels(page)).toHaveText([
    "Pexels videos",
    "AI images with FAL (paid, asks first)",
    "Use my photos",
    "Mix my photos and Pexels and FAL"
  ]);
  // Pexels and FAL are connected in this harness; Civitai is unreachable here,
  // so it is neither offered as an answer nor advertised in the strip.
  await expect(page.getByText(/should I use pictures of San Francisco from Pexels or FAL\?/).first()).toBeVisible();
  await expect(page.locator(".media-sources-strip .media-source-chip").filter({ hasText: "Civitai" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Civitai images" })).toHaveCount(0);
  await page.getByRole("button", { name: "Use my photos", exact: true }).click();
  // With no files yet the chat asks for the photos instead of faking a fill.
  await expect(page.getByText("Add your photos or clips. I will look at them first, then ask only what is still missing.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toHaveCount(0);
  // The answer is remembered for the next Create chat.
  expect(await page.evaluate(() => localStorage.getItem("fengine-visual-source"))).toBe("own");
});

test("choosing AI images from FAL on a 390px phone makes AI images instead of stock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  await page.getByRole("button", { name: "AI images with FAL (paid, asks first)" }).click();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({
    hasText: "Make AI images scene by scene with your FAL key"
  }).first()).toBeVisible();
  // Nothing was auto-matched from Pexels behind the answer.
  await expect(page.getByRole("button", { name: "Edit scene 1" }).locator("img")).toHaveCount(0);
});

test("a Civitai answer stays references and never auto-fills the storyboard", async ({ page }) => {
  await page.route("**/api/providers/civitai/credential", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ provider: "civitai", connected: true, hint: "1234" })
    });
  });
  await page.route("**/api/providers/civitai/settings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        max_nsfw_level: "Soft",
        allowed_creators: [],
        min_short_side: 1024,
        server_max_nsfw_level: "Soft"
      })
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  await expect(briefChoiceLabels(page)).toHaveText([
    "Pexels videos",
    "Civitai images",
    "AI images with FAL (paid, asks first)",
    "Use my photos",
    "Mix my photos and Pexels, Civitai and FAL"
  ]);
  await expect(page.locator(".media-sources-strip .media-source-chip").filter({ hasText: "Civitai" }))
    .toHaveAttribute("data-state", "connected");
  await page.getByRole("button", { name: "Civitai images" }).click();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Civitai images are references" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit scene 1" }).locator("img")).toHaveCount(0);
});

test("a Pexels-only studio offers one mix answer and names the locked key in Settings", async ({ page }) => {
  await stubProvidersDisconnected(page, ["fal"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  await expect(briefChoiceLabels(page)).toHaveText([
    "Pexels videos",
    "Use my photos",
    "Mix my photos and Pexels"
  ]);
  // The locked key is never an answer, only one line that says where to fix it.
  await expect(page.getByText("Connect FAL in Settings to use it here.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "AI images with FAL (paid, asks first)" })).toHaveCount(0);
  const calls: string[] = [];
  page.on("request", (request) => calls.push(`${request.method()} ${request.url()}`));
  await page.getByRole("button", { name: "Mix my photos and Pexels" }).click();
  // A mix without photos asks for them in the chat instead of quietly using
  // stock alone, and no storyboard opens until the photos arrive.
  await expect(page.getByText("Add the photos you want to mix, one per scene; Pexels can fill the rest.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add photos or clips" })).toBeVisible();
  expect(calls.filter((call) => call.includes("/api/pexels/search"))).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("fengine-visual-source"))).toBe("mix");
});

test("a mix answer on a 390px phone asks for photos without buying stock or images", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  const calls: string[] = [];
  page.on("request", (request) => calls.push(`${request.method()} ${request.url()}`));
  await page.getByRole("button", { name: "Mix my photos and Pexels and FAL" }).click();
  await expect(page.getByText("Add the photos you want to mix, one per scene; Pexels and FAL can fill the rest.").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toHaveCount(0);
  // No licensed search, no FAL quote, so the answer costs nothing yet.
  const paid = calls.filter((call) => /\/api\/pexels\/search|\/fal\/(image|video)-quotes/.test(call));
  expect(paid).toEqual([]);
});

test("the remembered picture answer leads the next Create chat", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.evaluate(() => localStorage.setItem("fengine-visual-source", "fal"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  await expect(briefChoiceLabels(page).first()).toHaveText("AI images with FAL (paid, asks first)");
});

test("a remembered picture answer is dropped once its key goes away", async ({ page }) => {
  await stubProvidersDisconnected(page, ["fal"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.evaluate(() => localStorage.setItem("fengine-visual-source", "fal"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  // The key is gone, so its answer is gone too: Pexels leads and says where FAL lives.
  await expect(briefChoiceLabels(page).first()).toHaveText("Pexels videos");
  await expect(page.getByRole("button", { name: "AI images with FAL (paid, asks first)" })).toHaveCount(0);
  await expect(page.getByText("Connect FAL in Settings to use it here.").first()).toBeVisible();
});

/** Makes a provider answer as "no key saved" in this harness. */
async function stubProvidersDisconnected(page: Page, providers: readonly string[]): Promise<void> {
  for (const provider of providers) {
    await page.route(`**/api/providers/${provider}/credential`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider, connected: false })
      });
    });
  }
}

test("a studio with only own photos is never asked where pictures come from", async ({ page }) => {
  await stubProvidersDisconnected(page, ["pexels", "fal"]);
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Message F-Motion").fill("mystery murder in san francisco");
  await page.getByRole("button", { name: "Send" }).click();
  await answerBriefSetup(page);
  // A single possible source is not a question, so the chat never asks.
  await expect(page.getByRole("button", { name: "Pexels videos" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use my photos", exact: true })).toHaveCount(0);
  await expect(page.getByText(/use your photos\./).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({
    hasText: "any other source needs a key in Settings first"
  })).toBeVisible();
});


