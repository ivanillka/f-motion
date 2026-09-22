import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("POST /api/briefs/next returns an opening slide then a reply-aware follow-up", async () => {
  const server = createServer(createTestApp({
    ownerId: "owner",
    projects: new ProjectService()
  }));
  const origin = await listen(server);
  try {
    const open = await fetch(`${origin}/api/briefs/next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation: "", has_own_media: false, asked: [] })
    });
    assert.equal(open.status, 200);
    const opening = await open.json();
    assert.equal(opening.ready, false);
    assert.equal(opening.question.id, "topic");
    assert.ok(opening.question.choices.includes("A quiet mystery"));

    const next = await fetch(`${origin}/v1/briefs/next`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversation: "A quiet mystery", has_own_media: false, asked: [] })
    });
    assert.equal(next.status, 200);
    const follow = await next.json();
    assert.equal(follow.ready, false);
    assert.equal(follow.question.id, "audience");
    assert.match(follow.question.prompt, /mystery/i);

    const quote = await fetch(`${origin}/api/quotes/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quantity: 4, kind: "final" })
    });
    assert.equal(quote.status, 200);
    assert.deepEqual(await quote.json(), {
      quantity: 4,
      kind: "final",
      unit: "render_unit",
      per_item: 2,
      total: 8
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
