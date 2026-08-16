import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";

const inventory = JSON.parse(await readFile(
  new URL("../../../packages/contracts/route-inventory.json", import.meta.url),
  "utf8"
));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

function samplePath(template) {
  return template
    .replaceAll("{project_id}", "project")
    .replaceAll("{asset_id}", "asset")
    .replaceAll("{job_id}", "job");
}

test("inventoried bearer routes are registered under /api and /v1", async () => {
  const server = createServer(createTestApp({
    ownerId: "owner",
    projects: new ProjectService()
  }));
  const origin = await listen(server);
  try {
    const bearerRoutes = inventory.versioned.filter((route) => route.auth === "bearer");
    assert.ok(bearerRoutes.length >= 20);
    for (const prefix of inventory.prefixes) {
      for (const route of bearerRoutes) {
        const url = `${origin}${prefix}${samplePath(route.path)}${route.path.includes("search") ? "?q=ocean" : ""}`;
        const response = await fetch(url, {
          method: route.method,
          headers: route.method === "GET" || route.method === "DELETE"
            ? undefined
            : { "content-type": "application/json" },
          body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}"
        });
        // Missing Express routes return a non-JSON 404. Registered handlers return
        // JSON (success or typed error), including resource not_found.
        const contentType = response.headers.get("content-type") ?? "";
        assert.match(contentType, /json/, `${route.method} ${prefix}${route.path} -> ${response.status}`);
      }
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("/v1 project create aliases /api with the same handler", async () => {
  const server = createServer(createTestApp({
    ownerId: "owner",
    projects: new ProjectService()
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Contract alias" })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.project.owner_id, "owner");
    assert.equal(body.project.brief.purpose, "Contract alias");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
