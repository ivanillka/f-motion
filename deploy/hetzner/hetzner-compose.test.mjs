import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const hetzner = join(root, "deploy/hetzner");

test("Hetzner hosted compose replaces Fly and keeps invite-only 1080p", async () => {
  const compose = await readFile(join(hetzner, "docker-compose.yml"), "utf8");
  const envExample = await readFile(join(hetzner, ".env.example"), "utf8");
  const nginx = await readFile(join(hetzner, "nginx.conf"), "utf8");
  const script = await readFile(join(root, "scripts/hetzner-up.sh"), "utf8");
  const guide = await readFile(join(root, "docs/runbooks/hosted-deploy.md"), "utf8");

  assert.match(compose, /api:/);
  assert.match(compose, /worker:/);
  assert.match(compose, /web:/);
  assert.doesNotMatch(compose, /postgres:|minio:/);
  assert.match(compose, /FENGINE_ENV: hosted/);
  assert.match(compose, /RENDER_WIDTH: \$\{RENDER_WIDTH:-1080\}/);
  assert.match(compose, /RENDER_HEIGHT: \$\{RENDER_HEIGHT:-1920\}/);
  assert.match(compose, /command: \["node", "apps\/worker\/dist\/start\.js"\]/);
  assert.match(compose, /VITE_SITE_AT_ROOT: "1"/);
  assert.doesNotMatch(compose, /fly launch|fly deploy|fly\.toml/);

  assert.match(envExample, /FENGINE_ENV=hosted/);
  assert.match(envExample, /FENGINE_ACCESS_MODE=invite_only/);
  assert.match(envExample, /RENDER_WIDTH=1080/);
  assert.match(envExample, /RENDER_HEIGHT=1920/);

  assert.match(nginx, /server_name api\.f-motion\.com/);
  assert.match(nginx, /proxy_pass http:\/\/api:3000/);
  assert.match(nginx, /location = \/api\/healthz/);
  assert.match(nginx, /proxy_buffering off/);

  assert.match(script, /deploy\/hetzner/);
  assert.match(script, /FENGINE_ENV=hosted/);
  assert.match(script, /invite_only/);
  assert.match(script, /Destroy the Fly apps/);

  assert.match(guide, /Hetzner/);
  assert.doesNotMatch(guide, /fly launch|fly deploy|fly secrets/);
});

test("hetzner-up refuses a missing env file", () => {
  const result = spawnSync("bash", ["scripts/hetzner-up.sh"], {
    cwd: root,
    env: { ...process.env, PATH: process.env.PATH },
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /deploy\/hetzner\/\.env|hosted|invite_only|placeholder|docker/i
  );
});
