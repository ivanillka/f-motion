import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  FAL_VISION_ENDPOINT_ID,
  FAL_VISION_MAX_CHARS,
  FAL_VISION_MAX_PHOTOS
} from "@f-engine/fal-host";
import {
  FalPhotoCaptionService,
  PhotoCaptionValidationError
} from "../dist/fal-photo-captions.js";
import { createTestApp } from "../dist/server.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    resolve(`http://127.0.0.1:${port}`);
  }));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

/** A key service that never touches a database. */
function credentials({ connected = true } = {}) {
  return {
    async status() { return { provider: "fal", connected }; },
    async connect() { throw new Error("unused"); },
    async test() { throw new Error("unused"); },
    async disconnect() { throw new Error("unused"); },
    async decryptForOwner() { return { id: "cred-1", apiKey: "owner-key-123456" }; }
  };
}

/** Answers like moondream2 and records what was sent. */
function visionFetch(caption = "A red boat moored at dawn.") {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ output: caption }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  impl.calls = calls;
  return impl;
}

function photo(hash, fill = "A") {
  return { hash, image: `data:image/jpeg;base64,${fill.repeat(8)}` };
}

test("photo captions read each photo once with the owner FAL key", async () => {
  const fetchImpl = visionFetch();
  const service = new FalPhotoCaptionService(credentials(), fetchImpl);
  const view = await service.describePhotos("owner", [photo("hash-one-1"), photo("hash-two-2", "B")]);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].url, `https://fal.run/${FAL_VISION_ENDPOINT_ID}`);
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).image_url, photo("hash-one-1").image);
  assert.equal(fetchImpl.calls[0].init.headers.authorization, "Key owner-key-123456");
  assert.equal(view.model, FAL_VISION_ENDPOINT_ID);
  assert.equal(view.max_photos, FAL_VISION_MAX_PHOTOS);
  assert.equal(view.price_per_1000_chars, 0.01);
  assert.equal(view.skipped, 0);
  assert.deepEqual(view.captions, [
    { hash: "hash-one-1", caption: "A red boat moored at dawn." },
    { hash: "hash-two-2", caption: "A red boat moored at dawn." }
  ]);
  // Two photos at the pinned rate and the pinned cap: honest, not rounded up.
  assert.equal(view.estimated_cost_usd, 0.0024);
});

test("a repeated photo is described once and the ninth is counted as skipped", async () => {
  const fetchImpl = visionFetch();
  const service = new FalPhotoCaptionService(credentials(), fetchImpl);
  const photos = [photo("hash-dup-1"), photo("hash-dup-1")];
  for (let index = 0; index < 10; index += 1) photos.push(photo(`hash-many-${index}-x`));
  const view = await service.describePhotos("owner", photos);
  assert.equal(view.captions.length, FAL_VISION_MAX_PHOTOS);
  assert.equal(fetchImpl.calls.length, FAL_VISION_MAX_PHOTOS);
  // Duplicates collapse, so only the photos past the cap are skipped.
  assert.equal(view.skipped, photos.length - 1 - FAL_VISION_MAX_PHOTOS);
  assert.equal(view.estimated_cost_usd, 0.0096);
});

test("a long caption is trimmed to the pinned length", async () => {
  const long = "word ".repeat(80).trim();
  const service = new FalPhotoCaptionService(credentials(), visionFetch(long));
  const view = await service.describePhotos("owner", [photo("hash-long-1")]);
  assert.ok(view.captions[0].caption.length <= FAL_VISION_MAX_CHARS);
});

test("a chat without a FAL key spends nothing, not even a request", async () => {
  const fetchImpl = visionFetch();
  const service = new FalPhotoCaptionService(credentials({ connected: false }), fetchImpl);
  await assert.rejects(
    () => service.describePhotos("owner", [photo("hash-nokey-1")]),
    (error) => error.name === "Gate0Error" && /FAL BYOK/u.test(error.message)
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("bad photo input is refused before any spend", async () => {
  const fetchImpl = visionFetch();
  const service = new FalPhotoCaptionService(credentials(), fetchImpl);
  const rejects = (photos) => assert.rejects(
    () => service.describePhotos("owner", photos),
    PhotoCaptionValidationError
  );
  await rejects([]);
  await rejects("hash-one-1");
  await rejects([{ hash: "hash-one-1" }]);
  await rejects([{ image: photo("hash-one-1").image }]);
  await rejects([{ hash: "x", image: photo("hash-one-1").image }]);
  // A link or a raw file is not a downscaled photo.
  await rejects([{ hash: "hash-link-1", image: "https://example.test/boat.jpg" }]);
  await rejects([{ hash: "hash-raw-1", image: "/tmp/boat.jpg" }]);
  await rejects([{ ...photo("hash-extra-1"), prompt: "add a boat" }]);
  assert.equal(fetchImpl.calls.length, 0);
});

test("FAL failures keep one honest error for the client", async () => {
  const rejected = new FalPhotoCaptionService(
    credentials(),
    async () => new Response("{}", { status: 401 })
  );
  await assert.rejects(
    () => rejected.describePhotos("owner", [photo("hash-bad-1")]),
    (error) => error.name === "FalImageError" && error.code === "credential"
  );
  const empty = new FalPhotoCaptionService(credentials(), async () => new Response(
    JSON.stringify({ output: "   " }),
    { status: 200, headers: { "content-type": "application/json" } }
  ));
  await assert.rejects(
    () => empty.describePhotos("owner", [photo("hash-empty-1")]),
    (error) => error.name === "FalImageError" && error.code === "unsafe_output"
  );
});

test("the photo caption route answers on /api and /v1 and stays owner scoped", async () => {
  const owners = [];
  const base = credentials();
  const service = new FalPhotoCaptionService({
    ...base,
    async status(ownerId) { owners.push(ownerId); return base.status(ownerId); },
    async decryptForOwner(ownerId) { owners.push(ownerId); return base.decryptForOwner(ownerId); }
  }, visionFetch());
  const server = createServer(createTestApp({ ownerId: "owner", photoCaptions: service }));
  const origin = await listen(server);
  try {
    for (const path of ["/api/photo-captions", "/v1/photo-captions"]) {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photos: [photo("hash-route-1")] })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.captions[0].hash, "hash-route-1");
      assert.equal(body.model, FAL_VISION_ENDPOINT_ID);
    }
    // Both calls stayed on the signed-in owner's key.
    assert.deepEqual([...new Set(owners)], ["owner"]);
    const extra = await fetch(`${origin}/api/photo-captions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photos: [photo("hash-route-1")], describe: true })
    });
    assert.equal(extra.status, 422);
    const missing = await fetch(`${origin}/api/photo-captions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(missing.status, 422);
  } finally {
    await close(server);
  }
});

test("the photo caption route reports a missing key and a disabled deployment", async () => {
  const noKey = new FalPhotoCaptionService(credentials({ connected: false }), visionFetch());
  const gateServer = createServer(createTestApp({ photoCaptions: noKey }));
  const gateOrigin = await listen(gateServer);
  try {
    const response = await fetch(`${gateOrigin}/api/photo-captions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photos: [photo("hash-gate-1")] })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).type, "gate0");
  } finally {
    await close(gateServer);
  }
  const offServer = createServer(createTestApp());
  const offOrigin = await listen(offServer);
  try {
    const response = await fetch(`${offOrigin}/api/photo-captions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photos: [photo("hash-off-1")] })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).type, "provider_unavailable");
  } finally {
    await close(offServer);
  }
});
