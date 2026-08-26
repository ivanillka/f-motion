import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
const root = new URL("..", import.meta.url);
const corePaths = [
  "packages/contracts/src",
  "packages/reel-engine/src",
  "apps/web/src/api.ts",
  "apps/api/src/domain.ts",
  "apps/api/src/media-storage.ts",
  "apps/api/src/render-repository.ts",
  "apps/api/src/mixkit-music.ts",
  "apps/api/src/mixkit-catalog.ts",
  "apps/worker/src"
];
const adapters = [
  "apps/api/src/product.ts",
  "apps/api/src/selfhost-auth.ts",
  "apps/web/src/auth.ts"
];
const productOnly = [
  /VITE_SELFHOST_AUTH/,
  /allowSelfhost/,
  /PostgresSelfhostOwner/,
  /SUPABASE_ISSUER/,
  /STRIPE_SECRET/,
  /FENGINE_ENV=corporate/,
  /invite_only/
];

async function filesUnder(relative) {
  const absolute = new URL(relative, root);
  const info = await stat(absolute);
  if (info.isFile()) return [relative];
  const found = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const next = `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await filesUnder(next));
    else if (entry.isFile() && /\.(ts|tsx|mjs)$/.test(entry.name)) found.push(next);
  }
  return found;
}

test("core studio files stay product-agnostic", async () => {
  const files = (await Promise.all(corePaths.map(filesUnder))).flat();
  assert.ok(files.length >= 10, "core file list is too small");
  for (const file of files) {
    const source = await readFile(new URL(file, root), "utf8");
    for (const pattern of productOnly) {
      assert.doesNotMatch(source, pattern, `${file} belongs to core; ${pattern} is a product adapter`);
    }
  }
});

test("product adapters exist so specifics are not stuffed into core", async () => {
  for (const file of adapters) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.ok(source.length > 0, file);
  }
});
