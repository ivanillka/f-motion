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

async function expectRenderedProject(rendered: APIResponse, expectedDurationMs: number): Promise<void> {
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
    expect(video).toMatchObject({ codec_name: "h264", width: 540, height: 960 });
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

async function attachFixtureToScene(page: Page, sceneNumber: number): Promise<void> {
  await page.getByRole("button", { name: `Edit scene ${sceneNumber}` }).click();
  const input = page.locator('input[type="file"]');
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

test("upload journey, natural conflict recovery, render, and download", async ({ page }) => {
  await page.route("https://e2e-storage.invalid/**", (route) =>
    route.fulfill({ status: 200, body: "" }));
  await page.setViewportSize({ width: 320, height: 900 });
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Visual description").fill("Launch a product for small teams");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
  await page.getByRole("button", { name: "Create new video" }).click();
  await expect(page.getByLabel("Visual description")).toHaveValue("Launch a product for small teams");
  await page.getByRole("button", { name: "Continue to video plan" }).click();
  await expect(page.getByLabel("Recommended video plan")).toContainText("Promote an idea or product");
  await expect(page.getByLabel("Where should visuals come from?")).not.toBeVisible();
  await page.getByText("Edit recommended video plan").click();
  await page.getByLabel("Where should visuals come from?").selectOption("own");
  await page.getByRole("button", { name: "Build storyboard" }).click();

  await expect(page.getByRole("heading", { name: "Upload your media" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles("apps/worker/test/fixtures/still.jpg");
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
  await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as new project" })).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();

  await page.getByRole("button", { name: "Generate accurate preview" }).click();
  await expect(page.getByRole("status").filter({ hasText: "complete · 720p preview" })).toBeVisible({ timeout: 30_000 });
  const download = page.getByRole("link").filter({ has: page.getByRole("button", { name: "Download preview" }) });
  await expect(page.getByRole("button", { name: "Download preview" })).toBeEnabled();
  await expect(page.locator("video")).toHaveAttribute("preload", "metadata");
  await expect(page.locator("video")).not.toHaveAttribute("autoplay", "");
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:43141\/downloads\//);
  const rendered = await page.request.get(href!);
  await expectRenderedProject(rendered, await projectDurationMs(page));
});

test("licensed stock journey explicitly selects candidates for a multi-scene render", async ({ page }) => {
  await page.route("https://e2e-images.invalid/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#333"/></svg>'
  }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Visual description").fill("A calm studio introduction");
  await page.getByRole("button", { name: "Continue to video plan" }).click();
  await expect(page.getByLabel("Recommended video plan")).toContainText("About 30 seconds");
  await expect(page.getByLabel("How should the story unfold?")).not.toBeVisible();
  await page.getByText("Edit recommended video plan").click();
  await page.getByLabel("How should the story unfold?").selectOption("mystery");
  await page.getByLabel("What tone fits best?").selectOption("documentary");
  await page.getByRole("button", { name: "Build storyboard" }).click();
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Move scene 1 earlier" })).toBeDisabled();
  await page.getByRole("button", { name: "Add scene" }).click();
  await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(6);
  await page.getByRole("button", { name: "Remove scene 2" }).click();
  await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(5);
  await page.getByRole("button", { name: "Remove scene 2" }).click();
  await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(4);
  await page.getByRole("button", { name: "Edit scene 1" }).click();
  const firstPrompt = page.getByLabel("Scene 1 footage search");
  await firstPrompt.fill("quiet cinematic studio with soft window light");
  await firstPrompt.press("Tab");
  await expect(page.getByRole("status").filter({ hasText: "All changes saved" })).toBeVisible();

  for (const sceneNumber of [1, 2, 3, 4]) {
    await page.getByRole("button", { name: `Edit scene ${sceneNumber}` }).click();
    await page.getByRole("button", { name: `Find licensed media for scene ${sceneNumber}` }).click();
    await expect(page.getByRole("button", { name: `Select for scene ${sceneNumber}` })).toHaveCount(2);
    const creator = sceneNumber === 1 ? "Fixture Two With A Long Name" : "Fixture One";
    await page.getByRole("article").filter({ hasText: creator }).getByRole("button", { name: `Select for scene ${sceneNumber}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `video by ${creator} on Pexels` })).toBeVisible();
  }

  await page.getByRole("button", { name: "Edit scene 2" }).click();
  await page.getByRole("button", { name: "Move scene 2 earlier" }).click();

  const attachedCreators = await page.evaluate(async () => {
    const projectId = localStorage.getItem("fengine-project");
    const { project } = await (await fetch(`/api/projects/${projectId}`)).json();
    return Promise.all(project.scenes.map(async ({ media_id }) => {
      const media = await (await fetch(`/api/projects/${projectId}/media/${media_id}`)).json();
      return media.attribution?.creator;
    }));
  });
  expect(attachedCreators.filter((creator) => creator === "Fixture Two With A Long Name")).toHaveLength(1);
  expect(attachedCreators.filter((creator) => creator === "Fixture One")).toHaveLength(3);

  await page.getByRole("button", { name: "Generate accurate preview" }).click();
  await expect(page.getByRole("status").filter({ hasText: "complete · 720p preview" })).toBeVisible({ timeout: 30_000 });
  const download = page.getByRole("link").filter({ has: page.getByRole("button", { name: "Download preview" }) });
  await expect(page.getByRole("button", { name: "Download preview" })).toBeEnabled();
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:43141\/downloads\//);
  const rendered = await page.request.get(href!);
  await expectRenderedProject(rendered, await projectDurationMs(page));

  await page.getByRole("button", { name: "Keep editing" }).click();
  const editedCaption = page.getByLabel("Scene 1 caption");
  await editedCaption.fill("Updated after preview");
  await editedCaption.press("Tab");
  await expect(page.getByRole("button", { name: /View accurate preview · older/ })).toBeVisible();
  await page.getByRole("button", { name: /View accurate preview · older/ }).click();
  await expect(page.getByText("Older preview — regenerate after your edits.")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Back to drafts" }).click();
  await page.getByRole("button").filter({ hasText: "A calm studio introduction" }).click();
  await expect(page.getByRole("button", { name: /^Edit scene/ })).toHaveCount(4);

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
