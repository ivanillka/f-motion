import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient, ApiResponseError, sceneDurationForMedia } from "../src/api.ts";

test("inspected video duration becomes a bounded scene duration", () => {
  assert.equal(sceneDurationForMedia(12_345.4, 3000), 12_345);
  assert.equal(sceneDurationForMedia(40_000, 3000), 15_000);
  assert.equal(sceneDurationForMedia(200, 3000), 500);
  assert.equal(sceneDurationForMedia(undefined, 3000), 3000);
});

test("API requests read the current token and report unauthorized sessions", async () => {
  const originalFetch = globalThis.fetch;
  let token = "first";
  let unauthorized = 0;
  const seen = [];
  globalThis.fetch = async (_path, init) => {
    seen.push(new Headers(init.headers).get("authorization"));
    return new Response(JSON.stringify({ message: "expired" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const client = new ApiClient(() => token, () => { unauthorized += 1; });
    token = "refreshed";
    await assert.rejects(client.request("/api/projects"), (error) =>
      error instanceof ApiResponseError && error.status === 401);
    assert.deepEqual(seen, ["Bearer refreshed"]);
    assert.equal(unauthorized, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("project listing rejects an HTML fallback response instead of crashing the page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!doctype html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });
  try {
    const client = new ApiClient(() => "token");
    await assert.rejects(client.listProjects(), /invalid projects response/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
