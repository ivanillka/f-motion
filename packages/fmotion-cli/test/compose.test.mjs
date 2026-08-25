import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { FmotionClient, composeReel } from "../dist/index.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  return `http://127.0.0.1:${address.port}`;
}

test("compose_reel chat-only creates a draft and does not render without media", async () => {
  const hits = [];
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/v1/projects") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        project: { id: "p1", revision: 0, scenes: [] },
        concepts: [{ id: "story" }, { id: "direct" }]
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/projects/p1/commands") {
      response.end(JSON.stringify({
        id: "p1",
        revision: 1,
        scenes: [
          { id: "s1", order: 0, duration_ms: 3000 },
          { id: "s2", order: 1, duration_ms: 3000 }
        ]
      }));
      return;
    }
    if (request.method === "GET" && request.url === "/v1/projects/p1") {
      response.end(JSON.stringify({
        project: {
          id: "p1",
          revision: 1,
          scenes: [
            { id: "s1", order: 0, duration_ms: 3000 },
            { id: "s2", order: 1, duration_ms: 3000 }
          ]
        }
      }));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  const origin = await listen(server);
  try {
    const result = await composeReel(new FmotionClient({
      apiOrigin: origin,
      apiKey: `fm_${"a".repeat(64)}`
    }), {
      purpose: "Quiet harbor for customers",
      render: "none",
      webOrigin: "https://f-motion.example"
    });
    assert.equal(result.project_id, "p1");
    assert.equal(result.next, "draft_only");
    assert.equal(result.draft_url, "https://f-motion.example/app/?project=p1");
    assert.equal(result.projectUrl, result.draft_url);
    assert.equal(result.render, undefined);
    assert.ok(!hits.some((hit) => hit.includes("/render")));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
