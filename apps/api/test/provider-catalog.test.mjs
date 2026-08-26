import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createTestApp } from "../dist/server.js";
import {
  listingHasCapability,
  listProviderIds,
  providerCapabilities,
  providerListing
} from "../dist/provider-catalog.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("catalog unlocks only the capabilities each provider actually has", () => {
  assert.deepEqual([...providerCapabilities.pexels], ["stock_video", "stock_still"]);
  assert.deepEqual([...providerCapabilities.pixabay], ["stock_video", "stock_still"]);
  assert.deepEqual([...providerCapabilities.fal], ["ai_image", "ai_video", "speech"]);
  assert.equal(providerCapabilities.fal.includes("stock_video"), false);
  assert.deepEqual(listProviderIds(), ["pexels", "pixabay", "fal"]);
});

test("a disconnected key does not unlock its capabilities", () => {
  const providers = [
    providerListing("pexels", { connected: false }, true),
    providerListing("pixabay", { connected: true, hint: "ab12" }, true),
    providerListing("fal", undefined, false)
  ];
  assert.equal(listingHasCapability(providers, "stock_video"), true);
  assert.equal(listingHasCapability(providers, "stock_still"), true);
  assert.equal(listingHasCapability(providers, "ai_image"), false);
  assert.equal(providers[0].connected, false);
  assert.equal(providers[1].connected, true);
  assert.equal(providers[2].enabled, false);
});

test("GET /api/providers lists the catalog when no BYOK services are wired", async () => {
  const server = createServer(createTestApp());
  const origin = await listen(server);
  try {
    const body = await (await fetch(`${origin}/api/providers`)).json();
    assert.deepEqual(body.providers.map(({ id, enabled, connected, capabilities }) => ({
      id, enabled, connected, capabilities
    })), [
      { id: "pexels", enabled: false, connected: false, capabilities: ["stock_video", "stock_still"] },
      { id: "pixabay", enabled: false, connected: false, capabilities: ["stock_video", "stock_still"] },
      { id: "fal", enabled: false, connected: false, capabilities: ["ai_image", "ai_video", "speech"] }
    ]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
