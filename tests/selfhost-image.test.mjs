import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("one-image files boot selfhost with a bootstrap token, not local auth", async () => {
  const entry = await readFile(new URL("../deploy/entrypoint.sh", import.meta.url), "utf8");
  const docker = await readFile(new URL("../deploy/Dockerfile", import.meta.url), "utf8");
  const compose = await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8");
  assert.match(entry, /FENGINE_ENV="\$\{FENGINE_ENV:-selfhost\}"/);
  assert.match(entry, /FENGINE_BOOTSTRAP_TOKEN/);
  assert.match(entry, /unset FENGINE_LOCAL_AUTH/);
  assert.match(entry, /prisma migrate deploy/);
  assert.match(entry, /CHECKPOINT_DISABLE=1/);
  assert.match(entry, /PRISMA_SCHEMA_ENGINE_BINARY/);
  assert.match(entry, /\/usr\/lib\/postgresql\/\*\/bin/);
  assert.doesNotMatch(entry, /\bnpx prisma\b/);
  assert.match(docker, /VITE_SELFHOST_AUTH=1/);
  assert.match(docker, /deploy\/entrypoint.sh/);
  assert.match(compose, /dockerfile: deploy\/Dockerfile/);
  assert.match(compose, /8080:8080/);
});
