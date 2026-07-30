import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const exporter = new URL("./export.mjs", import.meta.url);

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "fengine-export-repo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "tools", "publication"), { recursive: true });
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "README.md"), "committed public bytes\n");
  await writeFile(join(root, "private.txt"), "private\n");
  await writeFile(join(root, "deferred.txt"), "deferred\n");
  await writeFile(join(root, "bin", "run"), "#!/bin/sh\nexit 0\n");
  await chmod(join(root, "bin", "run"), 0o755);
  await writeFile(join(root, "tools", "publication", "manifest.json"), JSON.stringify({
    version: 1,
    rules: [
      {
        name: "public",
        classification: "public",
        paths: ["README.md", "bin/run"],
        reason: "test"
      },
      {
        name: "private",
        classification: "private",
        paths: ["private.txt", "tools/publication/manifest.json"],
        reason: "test"
      },
      {
        name: "deferred",
        classification: "public_after_neutralization",
        paths: ["deferred.txt"],
        reason: "test"
      },
      {
        name: "fallback",
        classification: "forbidden",
        fallback: true,
        reason: "test"
      }
    ]
  }));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Release Fixture");
  git(root, "config", "user.email", "release-fixture@invalid.example");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return { root, sha: git(root, "rev-parse", "HEAD") };
}

function run(root, args) {
  return spawnSync(process.execPath, [exporter.pathname, ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

test("export copies only public committed bytes and preserves executable mode", async (t) => {
  const { root, sha } = await repository(t);
  const output = await mkdtemp(join(tmpdir(), "fengine-export-output-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = run(root, ["--ref", sha, "--output", output]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(output, "README.md"), "utf8"), "committed public bytes\n");
  assert.notEqual((await stat(join(output, "bin", "run"))).mode & 0o111, 0);
  await assert.rejects(access(join(output, "private.txt")));
  await assert.rejects(access(join(output, "deferred.txt")));
  await assert.rejects(access(join(output, ".git")));
});

test("export refuses symbolic refs, dirty input, non-empty output, and broad targets", async (t) => {
  const symbolic = await repository(t);
  const symbolicOutput = await mkdtemp(join(tmpdir(), "fengine-export-symbolic-"));
  t.after(() => rm(symbolicOutput, { recursive: true, force: true }));
  assert.equal(run(symbolic.root, ["--ref", "HEAD", "--output", symbolicOutput]).status, 1);

  const nonempty = await repository(t);
  const nonemptyOutput = await mkdtemp(join(tmpdir(), "fengine-export-nonempty-"));
  t.after(() => rm(nonemptyOutput, { recursive: true, force: true }));
  await writeFile(join(nonemptyOutput, "existing"), "fixture");
  assert.equal(run(nonempty.root, ["--ref", nonempty.sha, "--output", nonemptyOutput]).status, 1);

  const dirty = await repository(t);
  const dirtyOutput = await mkdtemp(join(tmpdir(), "fengine-export-dirty-"));
  t.after(() => rm(dirtyOutput, { recursive: true, force: true }));
  await writeFile(join(dirty.root, "untracked"), "fixture");
  assert.equal(run(dirty.root, ["--ref", dirty.sha, "--output", dirtyOutput]).status, 1);

  const broad = await repository(t);
  assert.equal(run(broad.root, ["--ref", broad.sha, "--output", broad.root]).status, 1);
});
