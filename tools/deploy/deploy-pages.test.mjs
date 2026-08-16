import assert from "node:assert/strict";
import test from "node:test";
import { assertHostedWebEnvironment, deployPages, parseDeployArgs } from "./deploy-pages.mjs";

const hostedEnv = {
  VITE_SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "synthetic-public-browser-key"
};

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
    "/repo",
    hostedEnv
  );

  assert.deepEqual(calls, [
    { command: "npm", args: ["run", "build:pages"], cwd: "/repo" },
    {
      command: "npx",
      args: ["--yes", "wrangler", "pages", "deploy", "dist", "--project-name", "f-motion", "--branch", "main"],
      cwd: "/repo/apps/web"
    }
  ]);
});

test("deployment fails closed before build when hosted sign-in configuration is missing", () => {
  const calls = [];
  assert.throws(
    () => deployPages(parseDeployArgs(["--project-name", "f-motion"]), (...args) => calls.push(args), "/repo", {}),
    /VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY/
  );
  assert.deepEqual(calls, []);
  assert.throws(() => assertHostedWebEnvironment({ ...hostedEnv, VITE_ALLOW_DEMO_AUTH: "1" }), /must stay unset/);
  assert.throws(
    () => assertHostedWebEnvironment({
      ...hostedEnv,
      VITE_SUPABASE_URL: "https://hsasubgxsomjvwdlbexg.supabase.co"
    }),
    /not Fotium/
  );
});

test("deployment requires an explicit project name", () => {
  assert.throws(() => parseDeployArgs([]), /--project-name/);
  assert.throws(() => parseDeployArgs(["--project-name", "-unsafe"]), /--project-name/);
  assert.throws(() => parseDeployArgs(["--account-id", "secret"]), /Unknown argument/);
});
