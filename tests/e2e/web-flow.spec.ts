import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
}

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
  await page.getByRole("button", { name: "Use my own media instead" }).click();

  await expect(page.getByRole("heading", { name: "Upload your media" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles("apps/worker/test/fixtures/still.jpg");
  await expect(page.getByRole("heading", { name: "Video preview" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Media attached" })).toBeVisible();

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
  await page.getByLabel("Motion").selectOption("push");
  await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as new project" })).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();

  await page.getByRole("button", { name: "Render 720p preview" }).click();
  await expect(page.getByRole("status").filter({ hasText: "complete · 720p preview" })).toBeVisible();
  const download = page.getByRole("link").filter({ has: page.getByRole("button", { name: "Download video" }) });
  await expect(page.getByRole("button", { name: "Download video" })).toBeEnabled();
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:43141\/downloads\//);
  const rendered = await page.request.get(href!);
  expect(rendered.ok()).toBeTruthy();
  expect(rendered.headers()["content-type"]).toContain("video/mp4");
  expect((await rendered.body()).length).toBeGreaterThan(1000);
});

test("licensed stock journey shows previews and attribution", async ({ page }) => {
  await page.route("https://e2e-images.invalid/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#333"/></svg>'
  }));
  await signIn(page);
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Visual description").fill("A calm studio introduction");
  await page.getByRole("button", { name: "Create with licensed stock" }).click();

  await expect(page.getByRole("heading", { name: "Video preview" })).toBeVisible();
  await expect(page.getByAltText("Automatically selected stock video by Fixture One")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fixture One" })).toHaveAttribute(
    "href",
    "https://www.pexels.com/video/101"
  );
  await expect(page.getByRole("link", { name: "Pexels" }).first()).toBeVisible();
  await expect(page.getByRole("status").filter({
    hasText: "Visual matched automatically · video by Fixture One on Pexels"
  })).toBeVisible();

  await page.getByRole("button", { name: "Back to drafts" }).click();
  await page.getByRole("button").filter({ hasText: "A calm studio introduction" }).click();
  await expect(page.getByAltText("Automatically selected stock video by Fixture One")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fixture One" })).toHaveAttribute(
    "href",
    "https://www.pexels.com/video/101"
  );

  await page.getByRole("button", { name: "Back to drafts" }).click();
  await page.getByRole("button", { name: "Create new video" }).click();
  await page.getByLabel("Visual description").fill("A stormy mountain in cinematic fog");
  await page.getByRole("button", { name: "Create with licensed stock" }).click();
  await expect(page.getByAltText("Automatically selected stock video by Fixture Two With A Long Name")).toBeVisible();
  await expect(page.getByRole("link", { name: "Fixture Two With A Long Name" })).toHaveAttribute(
    "href",
    "https://www.pexels.com/video/102"
  );
  await expect(page.locator("body")).not.toContainText("Fixture One");

  await page.getByRole("button", { name: "Render 720p preview" }).click();
  await expect(page.getByRole("status").filter({ hasText: "complete · 720p preview" })).toBeVisible();
  const download = page.getByRole("link").filter({ has: page.getByRole("button", { name: "Download video" }) });
  await expect(page.getByRole("button", { name: "Download video" })).toBeEnabled();
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:43141\/downloads\//);
  const rendered = await page.request.get(href!);
  expect(rendered.ok()).toBeTruthy();
  expect(rendered.headers()["content-type"]).toContain("video/mp4");
  expect((await rendered.body()).length).toBeGreaterThan(1000);

  const storedSessionValues = await page.evaluate(() =>
    Object.values(sessionStorage));
  expect(storedSessionValues).not.toContainEqual(expect.stringMatching(/^local-demo-/));
  await expect(page.locator("body")).not.toContainText(/local-demo-|access_token/i);
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Settings" }).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Shape a vertical video" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Shape a vertical video" })).toBeVisible();
});
