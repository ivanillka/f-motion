#!/usr/bin/env node
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(toolDirectory, "../..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function loadManifest() {
  const configured = argument("--manifest");
  const path = configured ? resolve(configured) : resolve(toolDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.rules)) {
    throw new Error("unsupported publication manifest");
  }
  return manifest;
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

export function classify(path, manifest) {
  const matches = explicitMatches(path, manifest);
  if (matches.length > 1) return { error: "multiple", matches };
  if (matches.length === 1) return { rule: matches[0] };
  const fallbacks = manifest.rules.filter((rule) => rule.fallback);
  if (fallbacks.length === 1) return { rule: fallbacks[0] };
  return { error: fallbacks.length > 1 ? "multiple" : "unclassified", matches: fallbacks };
}

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function checkInventory(manifest) {
  const paths = (await stdin()).toString("utf8").split("\0").filter(Boolean);
  const seen = new Set(paths);
  const counts = {
    public: 0,
    private: 0,
    forbidden: 0,
    public_after_neutralization: 0
  };
  const violations = [];
  for (const path of paths) {
    const result = classify(path, manifest);
    if (result.error) {
      violations.push(`${path}: ${result.error}`);
      continue;
    }
    counts[result.rule.classification] = (counts[result.rule.classification] ?? 0) + 1;
  }
  for (const path of manifest.requiredPaths ?? []) {
    if (!seen.has(path)) violations.push(`${path}: required path missing`);
  }
  for (const violation of violations) process.stderr.write(`${violation}\n`);
  process.stdout.write(
    Object.entries(counts).map(([name, count]) => `${name}=${count}`).join(" ") + "\n"
  );
  if (violations.length) process.exitCode = 1;
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

function unsafeTarget(target) {
  const resolved = resolve(target);
  return !isAbsolute(target)
    || resolved === resolve("/")
    || resolved === repositoryRoot
    || resolved === resolve(homedir());
}

function forbiddenPath(path, manifest) {
  const parts = path.split("/");
  if (parts.some((part) => manifest.forbiddenBasenames?.includes(part))) return true;
  const lower = path.toLowerCase();
  return manifest.forbiddenExtensions?.some((extension) =>
    lower.endsWith(extension.toLowerCase()));
}

function isBinary(path, bytes, manifest) {
  if (manifest.binaryExtensions?.includes(extname(path).toLowerCase())) return true;
  return bytes.subarray(0, 8192).includes(0);
}

async function walk(root, directory = root) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    paths.push(absolute);
    if (entry.isDirectory()) paths.push(...await walk(root, absolute));
  }
  return paths;
}

async function checkTree(target, manifest) {
  if (!target || unsafeTarget(target)) throw new Error("unsafe tree target");
  const root = resolve(target);
  if (!(await stat(root)).isDirectory()) throw new Error("tree target is not a directory");
  const rootReal = await realpath(root);
  if ([resolve("/"), repositoryRoot, resolve(homedir())].includes(rootReal)) {
    throw new Error("unsafe tree target");
  }
  const violations = [];

  for (const absolute of await walk(root)) {
    const path = relative(root, absolute).split(sep).join("/");
    const facts = await lstat(absolute);
    if (forbiddenPath(path, manifest)) violations.push(`${path}: forbidden path`);

    if (facts.isSymbolicLink()) {
      const result = classify(path, manifest);
      if (result.error || result.rule?.classification !== "public") {
        violations.push(`${path}: ${result.error ?? result.rule.name}`);
      }
      const targetReal = await realpath(absolute).catch(() => "");
      if (!targetReal || !inside(rootReal, targetReal)) {
        violations.push(`${path}: escaping symlink`);
      }
      continue;
    }
    if (!facts.isFile()) continue;
    const result = classify(path, manifest);
    if (result.error || result.rule?.classification !== "public") {
      violations.push(`${path}: ${result.error ?? result.rule.name}`);
    }
    const bytes = await readFile(absolute);
    if (isBinary(path, bytes, manifest)) continue;
    const text = bytes.toString("utf8");
    for (const pattern of manifest.forbiddenTextPatterns ?? []) {
      if (new RegExp(pattern.pattern, pattern.flags).test(text)) {
        violations.push(`${path}: forbidden text (${pattern.name})`);
      }
    }
  }

  for (const violation of [...new Set(violations)].sort()) {
    process.stderr.write(`${violation}\n`);
  }
  if (violations.length) process.exitCode = 1;
  else process.stdout.write("candidate tree clean\n");
}

async function main() {
  const manifest = await loadManifest();
  if (process.argv.includes("--inventory0")) {
    await checkInventory(manifest);
    return;
  }
  const tree = argument("--tree");
  if (tree) {
    await checkTree(tree, manifest);
    return;
  }
  throw new Error("use --inventory0 or --tree <absolute-directory>");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "publication check failed"}\n`);
  process.exitCode = 1;
});
