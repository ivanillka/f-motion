import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const vps = join(root, "deploy/vps");

test("VPS compose path is single-seat, BYOK, and Fotium-free", async () => {
  const compose = await readFile(join(vps, "docker-compose.yml"), "utf8");
  const envExample = await readFile(join(vps, ".env.example"), "utf8");
  const script = await readFile(join(root, "scripts/vps-up.sh"), "utf8");
  const webDocker = await readFile(join(root, "apps/web/Dockerfile"), "utf8");
  const guide = await readFile(join(root, "docs/runbooks/vps-self-host.md"), "utf8");

  assert.match(compose, /postgres:/);
  assert.match(compose, /minio:/);
  assert.match(compose, /api:/);
  assert.match(compose, /worker:/);
  assert.match(compose, /web:/);
  assert.match(compose, /R2_PUBLIC_ENDPOINT/);
  assert.match(compose, /FENGINE_ENV: \$\{FENGINE_ENV:-selfhost\}/);
  assert.match(compose, /FENGINE_ACCESS_MODE: \$\{FENGINE_ACCESS_MODE:-single_user\}/);
  assert.doesNotMatch(compose, /fly\.toml|fotium\.vip|FENGINE_IMPORT_|VITE_PARTNER_BRAND/i);

  assert.match(envExample, /FENGINE_ENV=selfhost/);
  assert.match(envExample, /FENGINE_ACCESS_MODE=single_user/);
  assert.match(envExample, /FENGINE_PEXELS_BYOK_ENABLED=1/);
  assert.match(envExample, /FENGINE_FAL_BYOK_ENABLED=1/);
  assert.match(envExample, /invite_only/);
  assert.match(envExample, /paid corporate product|corporate/);
  assert.match(envExample, /Fotium partner chrome/);
  assert.doesNotMatch(envExample, /^VITE_PARTNER_BRAND_EMAIL=/m);
  assert.doesNotMatch(envExample, /^FENGINE_IMPORT_TOKEN=/m);

  assert.match(script, /deploy\/vps/);
  assert.match(script, /Fotium/);
  assert.match(script, /exactly one FENGINE_ALLOWED_USER_IDS/);
  assert.match(script, /single_user/);
  assert.match(webDocker, /VITE_PARTNER_BRAND_EMAIL=/);
  assert.match(webDocker, /VITE_ALLOW_DEMO_AUTH=/);
  assert.match(guide, /single user|single-seat|single seat/i);
  assert.match(guide, /corporate|paid/);
  assert.match(guide, /Fotium/);
  assert.match(guide, /Fly\.io/);
});

test("vps-up refuses a missing env file", () => {
  const result = spawnSync("bash", ["scripts/vps-up.sh"], {
    cwd: root,
    env: { ...process.env, PATH: process.env.PATH },
    encoding: "utf8"
  });
  // Without deploy/vps/.env the script copies the example and exits 1, or
  // refuses placeholders if .env already exists from a prior operator.
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /deploy\/vps\/\.env|Supabase|credential|Fotium|docker|single|UUID|paid/i
  );
});
