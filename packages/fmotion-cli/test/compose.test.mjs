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

test("compose_reel render:final uses the same compose path with kind final", async () => {
  const renders = [];
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/v1/projects") {
      response.statusCode = 201;
      response.end(JSON.stringify({
        project: { id: "p2", revision: 0, scenes: [] }
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/projects/p2/commands") {
      response.end(JSON.stringify({
        id: "p2",
        revision: 1,
        scenes: [{ id: "s1", order: 0, duration_ms: 3000, media_id: "m1" }]
      }));
      return;
    }
    if (request.method === "GET" && request.url === "/v1/projects/p2") {
      response.end(JSON.stringify({
        project: {
          id: "p2",
          revision: 1,
          scenes: [{ id: "s1", order: 0, duration_ms: 3000, media_id: "m1" }]
        }
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/projects/p2/render") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        renders.push(JSON.parse(body || "{}"));
        response.end(JSON.stringify({
          job_id: "job-final",
          project_id: "p2",
          revision: 1,
          kind: "final",
          state: "queued"
        }));
      });
      return;
    }
    if (request.url === "/v1/render-jobs/job-final/events") {
      response.setHeader("content-type", "text/event-stream");
      response.end("data: {\"job_id\":\"job-final\",\"phase\":\"complete\",\"percent\":100}\n\n");
      return;
    }
    if (request.url === "/v1/render-jobs/job-final/download") {
      response.end(JSON.stringify({
        url: "https://download.example/p2.mp4",
        expires_at: "2099-01-01T00:00:00.000Z",
        kind: "final"
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
      apiKey: `fm_${"b".repeat(64)}`
    }), {
      purpose: "Final export from singular compose",
      render: "final"
    });
    assert.deepEqual(renders, [{ kind: "final" }]);
    assert.equal(result.render?.kind, "final");
    assert.equal(result.render?.phase, "complete");
    assert.equal(result.render?.download?.url, "https://download.example/p2.mp4");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
