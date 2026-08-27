import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  await page.goto("/");
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
}


async function describeVideo(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message F-Motion").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  for (let step = 0; step < 4; step += 1) {
    if (await page.getByRole("heading", { name: "Storyboard" }).isVisible()) return;
    const choice = page.locator(".brief-chat-choices button").first();
    if (!await choice.isVisible()) break;
    await choice.click();
  }
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
}

async function sayOwnMedia(page: Page): Promise<void> {
  const own = page.getByRole("button", { name: "My own media", exact: true });
  if (await own.isVisible()) {
    await own.click();
    return;
  }
  await page.getByLabel("Message F-Motion").fill("My own media");
  await page.getByRole("button", { name: "Send" }).click();
}

async function briefWithOwnStill(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message F-Motion").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  let pickedOwn = false;
  for (let step = 0; step < 4; step += 1) {
    if (await page.getByRole("heading", { name: "Storyboard" }).isVisible()) return;
    const own = page.getByRole("button", { name: "My own media", exact: true });
    if (await own.isVisible()) {
      await own.click();
      pickedOwn = true;
      break;
    }
    const choice = page.locator(".brief-chat-choices button").first();
    if (!await choice.isVisible()) break;
    await choice.click();
  }
  if (!pickedOwn) await sayOwnMedia(page);
  await page.locator("section.create-brief input[type=file]").setInputFiles("apps/worker/test/fixtures/still.jpg");
  for (let step = 0; step < 4; step += 1) {
    if (await page.getByRole("heading", { name: "Storyboard" }).isVisible()) return;
    const choice = page.locator(".brief-chat-choices button").first();
    if (!await choice.isVisible()) break;
    await choice.click();
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
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.locator("section.create-brief input[type=file]").setInputFiles("apps/worker/test/fixtures/still.jpg");
  await expect(page.getByText(/I looked at 1 photo/i)).toBeVisible();
  await expect(page.locator(".brief-chat-choices button").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toHaveCount(0);
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

  await page.getByRole("button", { name: "Export final" }).click();
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
  await page.getByRole("button", { name: "Find another licensed video for scene 1" }).click();
  await expect(page.getByRole("button", { name: "Select for scene 1" })).toHaveCount(2);
  await page.getByRole("article").filter({ hasText: "Fixture Two With A Long Name" })
    .getByRole("button", { name: "Select for scene 1" }).click();
  await expect(page.getByRole("status").filter({ hasText: "video by Fixture Two With A Long Name on Pexels" })).toBeVisible();

  await page.getByRole("button", { name: "Edit scene 5" }).click();
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
  await briefWithOwnStill(page, "A fictional lighthouse that does not exist on stock");
  await createStoryboard(page);
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("status").filter({ hasText: "Media attached" })).toBeVisible();
  for (const sceneNumber of [2, 3, 4]) await attachFixtureToScene(page, sceneNumber);

  await page.getByRole("button", { name: "Edit scene 1" }).click();
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
