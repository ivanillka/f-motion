import assert from "node:assert/strict";
import test from "node:test";
import { deployPages, parseDeployArgs } from "./deploy-pages.mjs";

test("dry-run resolves the app directory without executing build or network commands", () => {
  const calls = [];
  deployPages(
    parseDeployArgs(["--project-name", "f-motion", "--dry-run"]),
    (...args) => calls.push(args),
    "/repo"
  );

  assert.deepEqual(calls, []);
});

test("deployment builds and verifies before invoking Wrangler from apps/web", () => {
  const calls = [];
  deployPages(
    parseDeployArgs(["--project-name", "f-motion"]),
    (command, args, cwd) => calls.push({ command, args, cwd }),
    "/repo"
  );

  assert.deepEqual(calls, [
    { command: "npm", args: ["run", "build:pages"], cwd: "/repo" },
    {
      command: "npx",
      args: ["--yes", "wrangler", "pages", "deploy", "dist", "--project-name", "f-motion"],
      cwd: "/repo/apps/web"
    }
  ]);
});

test("deployment requires an explicit project name", () => {
  assert.throws(() => parseDeployArgs([]), /--project-name/);
  assert.throws(() => parseDeployArgs(["--project-name", "-unsafe"]), /--project-name/);
  assert.throws(() => parseDeployArgs(["--account-id", "secret"]), /Unknown argument/);
});
