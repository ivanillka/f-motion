import assert from "node:assert/strict";
import test from "node:test";
import { onRequest, upstreamUrl } from "../functions/api/[[path]].js";

test("Pages proxy maps health to the API root", () => {
  assert.equal(
    upstreamUrl("https://f-motion.com/api/healthz?probe=1").href,
    "https://api.f-motion.com/healthz?probe=1"
  );
});

test("Pages proxy preserves API paths, methods, bodies, and authorization", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (request) => {
    forwarded = request;
    return new Response(null, { status: 204 });
  };

  try {
    const request = new Request("https://f-motion.com/api/projects?limit=2", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({ purpose: "Demo" })
    });
    const response = await onRequest({ request });

    assert.equal(response.status, 204);
    assert.equal(forwarded.url, "https://api.f-motion.com/api/projects?limit=2");
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.headers.get("authorization"), "Bearer test-token");
    assert.equal(await forwarded.text(), JSON.stringify({ purpose: "Demo" }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
