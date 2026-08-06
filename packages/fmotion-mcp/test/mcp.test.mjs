import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  return `http://127.0.0.1:${address.port}`;
}

function rpc(child, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("rpc timeout")), 2000);
    const onData = (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === message.id) {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            resolve(parsed);
            return;
          }
        } catch {
          /* keep reading */
        }
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test("fmotion-mcp lists tools and reports usage over /v1", async () => {
  const api = createServer((request, response) => {
    assert.equal(request.url, "/v1/me/usage");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ unit: "render_unit", balance: 12, free_grant: 25, costs: { preview: 1, final: 2 } }));
  });
  const origin = await listen(api);
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      FMOTION_API_KEY: `fm_${"a".repeat(64)}`,
      FMOTION_API_ORIGIN: origin
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  try {
    const init = await rpc(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } }
    });
    assert.equal(init.result.serverInfo.name, "fmotion-mcp");
    const tools = await rpc(child, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = tools.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      "create_project",
      "run_command",
      "request_render",
      "wait_render",
      "download_render",
      "usage"
    ]);
    const usage = await rpc(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "usage", arguments: {} }
    });
    assert.match(usage.result.content[0].text, /"balance": 12/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  }
});
