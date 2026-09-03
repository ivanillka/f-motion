#!/usr/bin/env node
/** Runnable agent-surface smoke: CLI client + MCP tools/list against a stub /v1. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { FmotionClient } from "../../packages/fmotion-cli/dist/client.js";

const mcpPath = fileURLToPath(new URL("../../packages/fmotion-mcp/dist/server.js", import.meta.url));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  return `http://127.0.0.1:${address.port}`;
}

const api = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/v1/me/usage") {
    response.end(JSON.stringify({ unit: "render_unit", balance: 7, free_grant: 25, costs: { preview: 1, final: 2 } }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ type: "not_found" }));
});

const origin = await listen(api);
const key = `fm_${"9".repeat(64)}`;
const client = new FmotionClient({ apiOrigin: origin, apiKey: key });
const usage = await client.usage();
assert.equal(usage.balance, 7);

const child = spawn(process.execPath, [mcpPath], {
  env: { ...process.env, FMOTION_API_KEY: key, FMOTION_API_ORIGIN: origin },
  stdio: ["pipe", "pipe", "pipe"]
});

const reply = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("mcp timeout")), 2000);
  child.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      const parsed = JSON.parse(line);
      if (parsed.id === 1) {
        clearTimeout(timer);
        resolve(parsed);
      }
    }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })}\n`);
});

assert.ok(reply.result.tools.some((tool) => tool.name === "usage"));
assert.ok(reply.result.tools.some((tool) => tool.name === "compose_reel"));
assert.ok(reply.result.tools.some((tool) => tool.name === "read_media"));
assert.ok(reply.result.tools.some((tool) => tool.name === "delete_project"));
child.kill("SIGTERM");
await new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
console.log("agents smoke ok");
