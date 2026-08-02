import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function parseDeployArgs(args) {
  let dryRun = false;
  let projectName;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--project-name") {
      if (projectName !== undefined) throw new Error("--project-name may only be supplied once");
      projectName = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!projectName || projectName.trim() !== projectName || /\s/.test(projectName) || projectName.startsWith("-")) {
    throw new Error("A non-empty --project-name value without whitespace is required");
  }

  return { dryRun, projectName };
}

export function assertHostedWebEnvironment(env) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const publicKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !publicKey) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required for a Pages deployment");
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid HTTPS origin");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("VITE_SUPABASE_URL must be a valid HTTPS origin");
  }
  if (publicKey.length < 20 || /\s/.test(publicKey)) {
    throw new Error("VITE_SUPABASE_ANON_KEY is invalid");
  }
  if (env.VITE_ALLOW_DEMO_AUTH !== undefined) {
    throw new Error("VITE_ALLOW_DEMO_AUTH must stay unset for a Pages deployment");
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

export function deployPages({ dryRun, projectName }, execute = run, root = repositoryRoot, env = process.env) {
  const appDirectory = resolve(root, "apps/web");
  const build = { command: "npm", args: ["run", "build:pages"], cwd: root };
  const deploy = {
    command: "npx",
    args: ["--yes", "wrangler", "pages", "deploy", "dist", "--project-name", projectName, "--branch", "main"],
    cwd: appDirectory
  };

  console.log(`App directory: ${appDirectory}`);
  console.log(`Build/check cwd: ${build.cwd}`);
  console.log(`Deploy command: ${deploy.command} ${deploy.args.join(" ")}`);

  if (dryRun) {
    console.log("Dry run: no commands executed.");
    return;
  }

  assertHostedWebEnvironment(env);
  execute(build.command, build.args, build.cwd);
  execute(deploy.command, deploy.args, deploy.cwd);
}

async function main() {
  deployPages(parseDeployArgs(process.argv.slice(2)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
