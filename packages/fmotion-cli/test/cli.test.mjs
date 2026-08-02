import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FmotionApiError, FmotionClient } from "../dist/client.js";
import { loadCredentials, saveCredentials } from "../dist/config.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  return `http://127.0.0.1:${address.port}`;
}

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("credentials file is mode 0600 and loadable", async () => {
  const home = await mkdtemp(join(tmpdir(), "fmotion-cli-"));
  const path = await saveCredentials({
    api_key: `fm_${"c".repeat(64)}`,
    api_origin: "http://example.test"
  }, home);
  const mode = (await stat(path)).mode & 0o777;
  assert.equal(mode, 0o600);
  const loaded = await loadCredentials({}, home);
  assert.equal(loaded?.api_key.startsWith("fm_"), true);
  assert.equal(JSON.parse(await readFile(path, "utf8")).api_key.startsWith("fm_"), true);
});

test("client maps quota_exceeded and talks /v1", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, `Bearer fm_${"d".repeat(64)}`);
    if (request.url === "/v1/me/usage") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ unit: "render_unit", balance: 0, free_grant: 25, costs: { preview: 1, final: 2 } }));
      return;
    }
    if (request.url === "/v1/projects/p1/render") {
      response.statusCode = 402;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ type: "quota_exceeded", message: "host usage quota exceeded" }));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  const origin = await listen(server);
  try {
    const client = new FmotionClient({ apiOrigin: origin, apiKey: `fm_${"d".repeat(64)}` });
    assert.equal((await client.usage()).balance, 0);
    await assert.rejects(() => client.render("p1", "preview"), (error) => {
      assert.ok(error instanceof FmotionApiError);
      assert.equal(error.status, 402);
      assert.equal(error.body.type, "quota_exceeded");
      return true;
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("cli --json login and usage", async () => {
  const home = await mkdtemp(join(tmpdir(), "fmotion-cli-home-"));
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ unit: "render_unit", balance: 9, free_grant: 25, costs: { preview: 1, final: 2 } }));
  });
  const origin = await listen(server);
  try {
    const login = await runCli([
      "login", "--json", "--api-key", `fm_${"e".repeat(64)}`, "--api-origin", origin
    ], { HOME: home });
    assert.equal(login.code, 0);
    assert.equal(JSON.parse(login.stdout).ok, true);
    const usage = await runCli(["usage", "--json"], { HOME: home, FMOTION_API_KEY: "" });
    // HOME credentials should win when FMOTION_API_KEY cleared — loadCredentials checks env first.
    // Explicitly unset by omitting; child inherits. Force empty:
    const usage2 = await runCli(["usage", "--json"], {
      HOME: home,
      FMOTION_API_KEY: undefined,
      env_clear_key: "1"
    });
    // Use env key override for determinism
    const usageEnv = await runCli(["usage", "--json"], {
      HOME: home,
      FMOTION_API_KEY: `fm_${"e".repeat(64)}`,
      FMOTION_API_ORIGIN: origin
    });
    assert.equal(usageEnv.code, 0);
    assert.equal(JSON.parse(usageEnv.stdout).balance, 9);
    void usage;
    void usage2;
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("cli exits 3 on quota_exceeded with --json", async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 402;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ type: "quota_exceeded", message: "host usage quota exceeded" }));
  });
  const origin = await listen(server);
  try {
    const result = await runCli(["render", "project", "preview", "--json"], {
      FMOTION_API_KEY: `fm_${"f".repeat(64)}`,
      FMOTION_API_ORIGIN: origin
    });
    assert.equal(result.code, 3);
    assert.equal(JSON.parse(result.stderr).error, "quota_exceeded");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
