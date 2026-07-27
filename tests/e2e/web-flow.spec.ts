import { expect, test } from "@playwright/test";

test("happy path, draft restart, conflict recovery, render reconnect, and download", async ({ page }) => {
  const resumedFrom: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/events")) {
      const lastEventId = request.headers()["last-event-id"];
      if (lastEventId) resumedFrom.push(lastEventId);
    }
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await page.getByLabel("Brief").fill("Launch a product for small teams");
  await page.reload();
  await expect(page.getByLabel("Brief")).toHaveValue("Launch a product for small teams");
  await page.getByRole("button", { name: "Review brief" }).click();
  await expect(page.getByRole("button", { name: /Direct/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Story/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Rhythm/ })).toBeVisible();
  await page.getByRole("button", { name: /Direct/ }).click();
  await page.getByRole("button", { name: "Use Direct" }).click();
  await expect(page.getByText(/Approximate preview/)).toBeVisible();
  await page.getByRole("button", { name: "Test stale revision" }).click();
  await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as new project" })).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();
  await page.getByRole("button", { name: /Render accurate/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "complete · 720p watermarked preview" })).toBeVisible();
  // Long-lived SSE completes on one connection; reconnects only happen after drops.
  expect(resumedFrom).toEqual([]);
  await expect(page.getByRole("button", { name: "Cancel render" })).toBeVisible();
  const download = page.getByRole("link");
  await expect(page.getByRole("button", { name: "Download preview" })).toBeEnabled();
  const href = await download.getAttribute("href");
  expect(href).toMatch(/^http:\/\/127\.0\.0\.1:43141\/downloads\//);
  const rendered = await page.request.get(href!);
  expect(rendered.ok()).toBeTruthy();
  expect(rendered.headers()["content-type"]).toContain("video/mp4");
  expect((await rendered.body()).length).toBeGreaterThan(1000);
});
