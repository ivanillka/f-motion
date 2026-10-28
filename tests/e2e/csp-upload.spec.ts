import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Any R2 account id: the shipped policy keeps the wildcard host.
const uploadOrigin = "https://e2eaccount.r2.cloudflarestorage.com";
const uploadUrl = `${uploadOrigin}/f-motion-media/media/pending/e2e-asset?X-Amz-Expires=300`;

/** The Content-Security-Policy that ships in apps/web/public/_headers. */
async function shippedPolicy(): Promise<string> {
  // Playwright runs from the repo root, same as the other specs.
  const headers = await readFile("apps/web/public/_headers", "utf8");
  const line = headers.split("\n").find((row) => row.includes("Content-Security-Policy:"));
  expect(line, "_headers carries a Content-Security-Policy").toBeTruthy();
  return line!.replace(/^.*Content-Security-Policy:\s*/u, "").trim();
}

test("the shipped CSP lets the studio PUT a presigned upload to R2", async ({ page }) => {
  const policy = await shippedPolicy();
  // Serve a page with the real policy so Chromium enforces exactly what ships.
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": policy
    });
    response.end("<!doctype html><title>csp upload</title><p id=ready>ready</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  let uploads = 0;
  await page.route(`${uploadOrigin}/**`, async (route) => {
    uploads += 1;
    // Mirrors deploy/r2-cors.json: the PUT sets content-type, so Chromium
    // preflights it and the answer has to allow that method and header.
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "PUT, GET, HEAD",
        "access-control-allow-headers": "content-type",
        "access-control-expose-headers": "etag",
        etag: "\"e2e\""
      },
      body: ""
    });
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    const result = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          body: new Uint8Array([0xff, 0xd8, 0xff])
        });
        return { status: response.status, error: "" };
      } catch (error) {
        return { status: 0, error: String(error) };
      }
    }, uploadUrl);
    expect(result.error, "connect-src blocks the presigned upload").toBe("");
    expect(result.status).toBe(200);
    expect(uploads).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
