import { expect, test } from "@playwright/test";

test("happy path, draft restart, conflict recovery, render reconnect, and download", async ({ page }) => {
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
  await page.getByRole("button", { name: "Simulate stale revision" }).click();
  await expect(page.getByRole("button", { name: "Reload latest" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as new project" })).toBeVisible();
  await page.getByRole("button", { name: "Reload latest" }).click();
  await page.getByRole("button", { name: /Render accurate/ }).click();
  await expect(page.getByText(/Rendering/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel render" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download preview" })).toBeVisible();
});
