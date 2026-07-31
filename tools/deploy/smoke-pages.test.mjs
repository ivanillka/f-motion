import assert from "node:assert/strict";
import test from "node:test";
import { parseSmokeArgs, smokePages } from "./smoke-pages.mjs";

const options = { origin: "https://app.example.com", timeoutMs: 50 };

test("accepts a successful same-origin JSON health response", async () => {
  let requested;
  const url = await smokePages(options, async (input) => {
    requested = input.href;
    return Response.json({ status: "ok" });
  });

  assert.equal(requested, "https://app.example.com/api/healthz");
  assert.equal(url, requested);
});

test("rejects SPA HTML returned from the API route", async () => {
  await assert.rejects(
    smokePages(options, async () => new Response("<!doctype html>", {
      headers: { "content-type": "text/html; charset=utf-8" }
    })),
    /non-JSON content-type: text\/html/
  );
});

test("rejects an upstream error", async () => {
  await assert.rejects(
    smokePages(options, async () => Response.json({ status: "unavailable" }, { status: 503 })),
    /HTTP 503/
  );
});

test("rejects redirects instead of following the health check off-origin", async () => {
  let redirectMode;
  await assert.rejects(
    smokePages(options, async (_input, init) => {
      redirectMode = init.redirect;
      return new Response(null, {
        status: 302,
        headers: { location: "https://api.example.com/healthz" }
      });
    }),
    /HTTP 302/
  );
  assert.equal(redirectMode, "manual");
});

test("aborts a timed-out request", async () => {
  await assert.rejects(
    smokePages({ ...options, timeoutMs: 5 }, (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })),
    /timed out after 5ms/
  );
});

test("requires an explicit bare HTTPS origin", () => {
  assert.throws(() => parseSmokeArgs([]), /explicit HTTPS origin/);
  assert.throws(() => parseSmokeArgs(["http://app.example.com"]), /HTTPS origin/);
  assert.throws(() => parseSmokeArgs(["https://app.example.com/path"]), /HTTPS origin/);
});
