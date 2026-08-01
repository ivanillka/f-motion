#!/usr/bin/env node
import { chmod, mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: options.encoding,
    maxBuffer: 100 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function explicitMatches(path, manifest) {
  return manifest.rules.filter((rule) => {
    if (rule.fallback) return false;
    const included = rule.paths?.includes(path)
      || rule.prefixes?.some((prefix) => path.startsWith(prefix));
    const excluded = rule.excludePaths?.includes(path)
      || rule.excludePrefixes?.some((prefix) => path.startsWith(prefix));
    return included && !excluded;
  });
}

function classification(path, manifest) {
  const matches = explicitMatches(path, manifest);
  if (matches.length > 1) throw new Error(`multiply classified path: ${path}`);
  if (matches.length === 1) return matches[0].classification;
  const fallbacks = manifest.rules.filter((rule) => rule.fallback);
  if (fallbacks.length !== 1) throw new Error(`unclassified path: ${path}`);
  return fallbacks[0].classification;
}

function safeOutput(path, repositoryRoot) {
  const resolved = resolve(path);
  return isAbsolute(path)
    && resolved !== resolve("/")
    && resolved !== resolve(homedir())
    && resolved !== repositoryRoot
    && !repositoryRoot.startsWith(`${resolved}${sep}`);
}

async function main() {
  const ref = argument("--ref");
  const output = argument("--output");
  if (!ref || !/^[0-9a-f]{40}$/i.test(ref)) {
    throw new Error("--ref must be a full commit SHA");
  }
  const repositoryRoot = String(git(["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8"
  })).trim();
  const resolvedRef = String(git(["rev-parse", `${ref}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8"
  })).trim();
  if (resolvedRef.toLowerCase() !== ref.toLowerCase()) throw new Error("ref is not an exact commit");
  if (String(git(["status", "--porcelain"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  })).trim()) {
    throw new Error("worktree must be clean before export");
  }
  if (!output || !safeOutput(output, repositoryRoot)) throw new Error("unsafe output directory");
  const outputRoot = resolve(output);
  if (!(await stat(outputRoot)).isDirectory()) throw new Error("output must be an existing directory");
  if ((await readdir(outputRoot)).length) throw new Error("output directory must be empty");
  const outputReal = await realpath(outputRoot);
  if (!safeOutput(outputReal, repositoryRoot)) throw new Error("unsafe output directory");

  const manifest = JSON.parse(Buffer.from(git(
    ["show", `${ref}:tools/publication/manifest.json`],
    { cwd: repositoryRoot }
  )).toString("utf8"));
  const records = Buffer.from(git(["ls-tree", "-r", "-z", ref], {
    cwd: repositoryRoot
  })).toString("utf8").split("\0").filter(Boolean);
  let exported = 0;
  for (const record of records) {
    const match = record.match(/^(\d+) (?:blob|commit) [0-9a-f]+\t(.+)$/s);
    if (!match) throw new Error("unexpected git tree record");
    const [, mode, path] = match;
    if (classification(path, manifest) !== "public") continue;
    const destination = resolve(outputRoot, path);
    if (!destination.startsWith(`${outputRoot}${sep}`)) throw new Error("unsafe exported path");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, git(["show", `${ref}:${path}`], { cwd: repositoryRoot }));
    if (mode === "100755") await chmod(destination, 0o755);
    exported += 1;
  }
  process.stdout.write(`exported ${exported} public paths from ${ref}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "publication export failed"}\n`);
  process.exitCode = 1;
});
