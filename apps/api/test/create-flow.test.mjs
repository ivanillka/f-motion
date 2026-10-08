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
