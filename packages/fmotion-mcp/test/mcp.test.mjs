import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      "read_media",
      "compose_reel",
      "open_draft",
      "create_project",
      "run_command",
      "request_render",
      "wait_render",
      "download_render",
      "usage",
      "delete_project"
    ]);
    const usage = await rpc(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "usage", arguments: {} }
    });
    assert.match(usage.result.content[0].text, /"balance": 12/);
    const directory = await mkdtemp(join(tmpdir(), "fmotion-mcp-media-"));
    const png = join(directory, "still.png");
    await writeFile(png, Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000000020001e221bc330000000049454e44ae426082",
      "hex"
    ));
    const read = await rpc(child, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "read_media", arguments: { paths: [png] } }
    });
    assert.match(read.result.content[0].text, /"image\/png"/);
    const draft = await rpc(child, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "open_draft", arguments: { project_id: "p1" } }
    });
    assert.match(draft.result.content[0].text, /\/app\/\?project=p1/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  }
});
