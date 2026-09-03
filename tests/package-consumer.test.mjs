import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);

function run(file, args, cwd, options = {}) {
  return execFileSync(file, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...options
  });
}

function pack(workspace, artifacts) {
  return JSON.parse(run("npm", [
    "pack",
    "--json",
    "--pack-destination",
    artifacts,
    "--workspace",
    workspace
  ], repositoryRoot))[0];
}

test("private package tarballs install and run outside the monorepo without registry access", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fengine-consumer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifacts = join(root, "artifacts");
  const consumer = join(root, "consumer");
  await mkdir(artifacts);
  await mkdir(consumer);

  run("npm", ["run", "build", "--workspace", "@f-engine/contracts"], repositoryRoot);
  run("npm", ["run", "build", "--workspace", "@f-engine/reel-engine"], repositoryRoot);
  const contracts = pack("@f-engine/contracts", artifacts);
  const engine = pack("@f-engine/reel-engine", artifacts);

  assert.deepEqual(
    contracts.files.map(({ path }) => path).sort(),
    [
      "dist/index.d.ts",
      "dist/index.js",
      "fixtures/error-render-capacity.json",
      "fixtures/error-render-input-incomplete.json",
      "fixtures/error-unauthorized.json",
      "fixtures/project-v1.json",
      "fixtures/project-v2-breaking.json",
      "fixtures/scene-media-ready.json",
      "fixtures/sse-progress.json",
      "fixtures/storyboard-plan-v1.json",
      "openapi.yaml",
      "package.json",
      "route-inventory.json",
      "schema/f-engine-v1.schema.json"
    ]
  );
  assert.deepEqual(
    engine.files.map(({ path }) => path).sort(),
    [
      "dist/brief-architecture.d.ts",
      "dist/brief-architecture.js",
      "dist/index.d.ts",
      "dist/index.js",
      "dist/media-intent.d.ts",
      "dist/media-intent.js",
      "package.json"
    ]
  );
  for (const entry of [...contracts.files, ...engine.files]) {
    assert.doesNotMatch(entry.path, /(?:^|\/)(?:test|plans|\.env)|\.tsbuildinfo$|\.map$/);
  }

  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "f-engine-consumer-fixture",
    private: true,
    type: "module"
  }));
  const contractsTarball = join(artifacts, contracts.filename);
  const engineTarball = join(artifacts, engine.filename);
  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    contractsTarball,
    engineTarball
  ], consumer);

  const output = run(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      const contracts = await import("@f-engine/contracts");
      const { renderPlan } = await import("@f-engine/reel-engine");
      const snapshot = {
        schema_version: 1,
        id: "fixture",
        owner_id: "owner",
        revision: 0,
        brief: { purpose: "Fixture", audience: "Test", tone: "Neutral" },
        scenes: []
      };
      if (!contracts.acceptsFixture(snapshot)) throw new Error("contract import failed");
      const plan = renderPlan(snapshot, {
        width: 1080,
        height: 1920,
        watermark: "Consumer"
      });
      process.stdout.write(JSON.stringify({
        width: plan.width,
        height: plan.height,
        watermark: plan.watermark
      }));
    `
  ], consumer);
  assert.deepEqual(JSON.parse(output), {
    width: 1080,
    height: 1920,
    watermark: "Consumer"
  });
});
