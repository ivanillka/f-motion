import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function json(origin, path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init
  });
  return { status: response.status, body: await response.json() };
}

test("create-flow lists reel as the only polish-ready type and generates a storyboard artifact", async () => {
  const server = createServer(createTestApp({ ownerId: "create-flow-owner" }));
  const origin = await listen(server);
  try {
    const types = await fetch(`${origin}/api/content-types`);
    assert.equal(types.status, 200);
    const typeBody = await types.json();
    assert.deepEqual(typeBody.types.map((item) => item.typeId), ["reel_vertical"]);

    const created = await fetch(`${origin}/api/create-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        skipPool: true,
        brief: { purpose: "Harbor night market for visitors" }
      })
    });
    assert.equal(created.status, 201);
    let session = (await created.json()).session;
    assert.equal(session.poolMode, "skipped");

    const pool = await fetch(`${origin}/api/create-sessions/${session.id}/pool/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: "m1", kind: "image", score: 0.9 },
          { id: "m2", kind: "image", score: 0.8 }
        ]
      })
    });
    assert.equal(pool.status, 200);
    session = (await pool.json()).session;

    const settings = await fetch(`${origin}/api/create-sessions/${session.id}/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedTypeIds: ["reel_vertical"],
        mediaSourcePref: "own",
        typeSettings: { reel_vertical: { durationSeconds: 15 } }
      })
    });
    assert.equal(settings.status, 200);

    const generated = await fetch(`${origin}/api/create-sessions/${session.id}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    assert.equal(generated.status, 200);
    session = (await generated.json()).session;
    assert.equal(session.status, "done");
    assert.equal(session.artifacts.length, 1);
    assert.equal(session.artifacts[0].typeId, "reel_vertical");
    assert.equal(session.artifacts[0].status, "ready");
    assert.equal(session.artifacts[0].craftPayload.kind, "reel_storyboard");
    assert.ok(session.artifacts[0].craftPayload.scenes.length >= 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("create-flow skip-pool with defer generates storyboard without own media", async () => {
  const server = createServer(createTestApp({ ownerId: "skip-pool-owner" }));
  const origin = await listen(server);
  try {
    const created = await json(origin, "/api/create-sessions", {
      method: "POST",
      body: JSON.stringify({
        skipPool: true,
        brief: { purpose: "Harbor night market for visitors" }
      })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.session.poolMode, "skipped");
    const id = created.body.session.id;

    const ownPref = await json(origin, `/api/create-sessions/${id}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        selectedTypeIds: ["reel_vertical"],
        mediaSourcePref: "own",
        typeSettings: { reel_vertical: { durationSeconds: 15 } }
      })
    });
    assert.equal(ownPref.status, 200);
    const ownGenerate = await json(origin, `/api/create-sessions/${id}/generate`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(ownGenerate.status, 400);
    assert.match(ownGenerate.body.message, /own media required/i);

    const defer = await json(origin, `/api/create-sessions/${id}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        selectedTypeIds: ["reel_vertical"],
        mediaSourcePref: "defer",
        typeSettings: { reel_vertical: { durationSeconds: 15 } }
      })
    });
    assert.equal(defer.status, 200);
    const generated = await json(origin, `/api/create-sessions/${id}/generate`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.session.status, "done");
    assert.equal(generated.body.session.poolMode, "skipped");
    assert.equal(generated.body.session.artifacts[0].craftPayload.kind, "reel_storyboard");
    assert.ok(generated.body.session.artifacts[0].craftPayload.scenes.length >= 1);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("create-flow mixed pool unique-attaches stills and clips", async () => {
  const server = createServer(createTestApp({ ownerId: "pool-owner" }));
  const origin = await listen(server);
  try {
    const created = await json(origin, "/api/create-sessions", {
      method: "POST",
      body: JSON.stringify({
        skipPool: false,
        brief: { purpose: "Cafe morning for locals" }
      })
    });
    assert.equal(created.status, 201);
    const id = created.body.session.id;
    const pool = await json(origin, `/api/create-sessions/${id}/pool/items`, {
      method: "POST",
      body: JSON.stringify({
        items: [
          { id: "still-a", kind: "image", score: 0.95 },
          { id: "clip-b", kind: "video", score: 0.9 },
          { id: "still-c", kind: "image", score: 0.85 },
          { id: "clip-d", kind: "video", score: 0.8 }
        ]
      })
    });
    assert.equal(pool.status, 200);
    assert.equal(pool.body.session.poolMode, "filled");

    await json(origin, `/api/create-sessions/${id}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        selectedTypeIds: ["reel_vertical"],
        mediaSourcePref: "own",
        typeSettings: { reel_vertical: { durationSeconds: 15, uniqueAttach: true } }
      })
    });
    const generated = await json(origin, `/api/create-sessions/${id}/generate`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(generated.status, 200);
    const attached = generated.body.session.artifacts[0].craftPayload.mediaAttach
      .map((item) => item.mediaId)
      .filter(Boolean);
    assert.ok(attached.length >= 1);
    assert.equal(new Set(attached).size, attached.length);
    assert.ok(attached.includes("still-a") || attached.includes("clip-b"));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("create-flow Gate0 denies Pexels pref and animateStills without BYOK", async () => {
  // createTestApp has no credential services → byokKeys are false.
  const server = createServer(createTestApp({ ownerId: "gate0-owner" }));
  const origin = await listen(server);
  try {
    const created = await json(origin, "/api/create-sessions", {
      method: "POST",
      body: JSON.stringify({ skipPool: true, brief: { purpose: "Gate check" } })
    });
    assert.equal(created.status, 201);
    const id = created.body.session.id;

    const pexels = await json(origin, `/api/create-sessions/${id}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        selectedTypeIds: ["reel_vertical"],
        mediaSourcePref: "pexels",
        typeSettings: { reel_vertical: { durationSeconds: 15 } }
      })
    });
    assert.equal(pexels.status, 403);
    assert.equal(pexels.body.type, "gate0");
    assert.match(pexels.body.message, /Pexels/i);

    const animate = await json(origin, `/api/create-sessions/${id}/settings`, {
      method: "PATCH",
      body: JSON.stringify({
        selectedTypeIds: ["reel_vertical"],
        mediaSourcePref: "own",
        typeSettings: { reel_vertical: { durationSeconds: 15, animateStills: true } }
      })
    });
    assert.equal(animate.status, 403);
    assert.equal(animate.body.type, "gate0");
    assert.match(animate.body.message, /FAL/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
