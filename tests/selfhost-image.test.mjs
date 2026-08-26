import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("one-image files boot selfhost with a first owner, not a bootstrap token", async () => {
  const entry = await readFile(new URL("../deploy/entrypoint.sh", import.meta.url), "utf8");
  const docker = await readFile(new URL("../deploy/Dockerfile", import.meta.url), "utf8");
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.match(entry, /FENGINE_ENV="\$\{FENGINE_ENV:-selfhost\}"/);
  assert.match(entry, /unset FENGINE_BOOTSTRAP_TOKEN/);
  assert.match(entry, /unset FENGINE_LOCAL_AUTH/);
  assert.match(entry, /credential-key/);
  assert.match(entry, /prisma migrate deploy/);
  assert.match(entry, /CHECKPOINT_DISABLE=1/);
  assert.match(entry, /PRISMA_SCHEMA_ENGINE_BINARY/);
  assert.match(entry, /\/usr\/lib\/postgresql\/\*\/bin/);
  assert.doesNotMatch(entry, /\bnpx prisma\b/);
  assert.doesNotMatch(entry, /operator token/);
  assert.match(docker, /VITE_SELFHOST_AUTH=1/);
  assert.doesNotMatch(docker, /VITE_SUPABASE_URL/);
  assert.doesNotMatch(docker, /VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(docker, /VITE_ENABLE_GOOGLE_AUTH/);
  assert.match(docker, /deploy\/entrypoint.sh/);
  assert.match(compose, /dockerfile: deploy\/Dockerfile/);
  assert.match(compose, /8080:8080/);
  assert.match(compose, /FENGINE_PEXELS_BYOK_ENABLED: "1"/);
  assert.match(compose, /FENGINE_PIXABAY_BYOK_ENABLED: "1"/);
  assert.match(compose, /FENGINE_FAL_BYOK_ENABLED: "1"/);
});

test("one-image Caddy and runbook serve studio at / with owner onboarding", async () => {
  const caddy = await readFile(new URL("../deploy/Caddyfile", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/runbooks/self-host.md", import.meta.url), "utf8");
  assert.match(caddy, /redir @one_url \/ 301/);
  for (const path of ["/self-host", "/hosted", "/studio", "/app"]) {
    assert.match(caddy, new RegExp(path.replace("/", "\\/")));
  }
  assert.match(docs, /VPS product/);
  assert.match(docs, /not f-motion.com and not the corporate teams product/);
  assert.match(docs, /Open `http:\/\/127\.0\.0\.1:8080\/` and create the owner/);
  assert.match(docs, /FENGINE_SELFHOST_RESET_OWNER/);
  assert.match(docs, /GET \/` — studio/);
  assert.match(docs, /\/studio` may 301 to `\//);
  assert.doesNotMatch(docs, /marketing home/);
  assert.doesNotMatch(docs, /marketing at/);
  assert.doesNotMatch(docs, /operator token/);
  assert.doesNotMatch(docs, /BOOTSTRAP_TOKEN/);
});
