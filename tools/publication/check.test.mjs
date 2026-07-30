import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const checker = new URL("./check.mjs", import.meta.url);

async function fixture(t, rules = [{
  name: "fixture-public",
  classification: "public",
  prefixes: [""],
  reason: "test"
}]) {
  const base = await mkdtemp(join(tmpdir(), "fengine-check-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, "candidate");
  await mkdir(root);
  const manifestPath = join(base, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    version: 1,
    rules,
    forbiddenBasenames: [".git", ".env"],
    forbiddenExtensions: [".crt", ".dump"],
    binaryExtensions: [".png"],
    forbiddenTextPatterns: [
      { name: "product", pattern: "Fotium", flags: "i" },
      { name: "private-key", pattern: "-----BEGIN PRIVATE KEY-----", flags: "" }
    ]
  }));
  return { root, manifestPath };
}

function run(args, input) {
  return spawnSync(process.execPath, [checker.pathname, ...args], {
    input,
    encoding: "utf8"
  });
}

test("clean public candidate passes", async (t) => {
  const { root, manifestPath } = await fixture(t);
  await writeFile(join(root, "README.md"), "Neutral project\n");
  const result = run(["--manifest", manifestPath, "--tree", root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /candidate tree clean/);
});

test("product marker fails without printing matched contents", async (t) => {
  const { root, manifestPath } = await fixture(t);
  await writeFile(join(root, "README.md"), "Fotium internal phrase that must stay private\n");
  const result = run(["--manifest", manifestPath, "--tree", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /README\.md: forbidden text \(product\)/);
  assert.doesNotMatch(result.stderr, /internal phrase/);
});

test("environment, certificate, dump, git, and private-key markers fail", async (t) => {
  const { root, manifestPath } = await fixture(t);
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "config"), "safe");
  await writeFile(join(root, ".env"), "SAFE=fixture");
  await writeFile(join(root, "server.crt"), "fixture");
  await writeFile(join(root, "database.dump"), "fixture");
  await writeFile(join(root, "notes.txt"), "-----BEGIN PRIVATE KEY-----");
  const result = run(["--manifest", manifestPath, "--tree", root]);
  assert.equal(result.status, 1);
  for (const path of [".git/config", ".env", "server.crt", "database.dump", "notes.txt"]) {
    assert.match(result.stderr, new RegExp(path.replace(/[.]/g, "\\.")));
  }
});

test("escaping symlink fails", async (t) => {
  const { root, manifestPath } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "fengine-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, "secret.txt"), "fixture");
  await symlink(join(outside, "secret.txt"), join(root, "escape"));
  const result = run(["--manifest", manifestPath, "--tree", root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /escape: escaping symlink/);
});

test("inventory rejects unclassified and multiply classified paths", async (t) => {
  const unclassified = await fixture(t, []);
  const first = run(
    ["--manifest", unclassified.manifestPath, "--inventory0"],
    Buffer.from("unknown.txt\0")
  );
  assert.equal(first.status, 1);
  assert.match(first.stderr, /unknown\.txt: unclassified/);

  const multiple = await fixture(t, [
    { name: "one", classification: "public", prefixes: ["src/"], reason: "test" },
    { name: "two", classification: "private", paths: ["src/index.js"], reason: "test" }
  ]);
  const second = run(
    ["--manifest", multiple.manifestPath, "--inventory0"],
    Buffer.from("src/index.js\0")
  );
  assert.equal(second.status, 1);
  assert.match(second.stderr, /src\/index\.js: multiple/);
});

test("known binary content is not decoded or logged", async (t) => {
  const { root, manifestPath } = await fixture(t);
  await writeFile(join(root, "fixture.png"), Buffer.from("Fotium\0binary"));
  const result = run(["--manifest", manifestPath, "--tree", root]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Fotium/);
});

test("broad tree target is refused", async (t) => {
  const { manifestPath } = await fixture(t);
  const result = run(["--manifest", manifestPath, "--tree", "/"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe tree target/);
});
