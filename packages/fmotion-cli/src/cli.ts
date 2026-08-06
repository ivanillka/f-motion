#!/usr/bin/env node
import { FmotionApiError, FmotionClient } from "./client.js";
import { loadCredentials, saveCredentials } from "./config.js";

type Flags = {
  json: boolean;
  args: string[];
  options: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Flags {
  const options: Record<string, string | boolean> = {};
  const args: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i += 1;
      } else {
        options[key] = true;
      }
      continue;
    }
    args.push(token);
  }
  return { json, args, options };
}

function exitCodeFor(error: unknown): number {
  if (error instanceof FmotionApiError) {
    if (error.body.type === "quota_exceeded") return 3;
    if (error.status === 401 || error.status === 403) return 2;
    if (error.status === 404) return 4;
    if (error.status === 409) return 5;
    if (error.status === 422) return 6;
    return 1;
  }
  return 1;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function clientFromEnv(): Promise<FmotionClient> {
  const credentials = await loadCredentials();
  if (!credentials) {
    throw new Error("Not configured. Run `fmotion login --api-key fm_… --api-origin https://…` or set FMOTION_API_KEY.");
  }
  return new FmotionClient({ apiOrigin: credentials.api_origin, apiKey: credentials.api_key });
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const flags = parseArgs(argv);
  const [command, ...rest] = flags.args;
  try {
    switch (command) {
      case "login":
      case "config": {
        const apiKey = String(flags.options["api-key"] || flags.options.key || "");
        const apiOrigin = String(flags.options["api-origin"] || flags.options.origin || "http://127.0.0.1:3000");
        if (!apiKey) throw new Error("Missing --api-key fm_…");
        const path = await saveCredentials({ api_key: apiKey, api_origin: apiOrigin });
        print(flags.json ? { ok: true, path } : `Saved credentials to ${path}`, flags.json);
        return 0;
      }
      case "usage": {
        print(await (await clientFromEnv()).usage(), flags.json);
        return 0;
      }
      case "projects": {
        const sub = rest[0];
        const client = await clientFromEnv();
        if (!sub || sub === "list") {
          print(await client.listProjects(), flags.json);
          return 0;
        }
        if (sub === "create") {
          const purpose = String(flags.options.purpose || rest[1] || "");
          if (!purpose) throw new Error("Missing --purpose");
          print(await client.createProject({
            purpose,
            ...(flags.options.audience ? { audience: String(flags.options.audience) } : {}),
            ...(flags.options.tone ? { tone: String(flags.options.tone) } : {})
          }), flags.json);
          return 0;
        }
        if (sub === "get") {
          const id = rest[1] || String(flags.options.id || "");
          if (!id) throw new Error("Missing project id");
          print(await client.getProject(id), flags.json);
          return 0;
        }
        throw new Error("Usage: fmotion projects [list|create|get]");
      }
      case "command": {
        const projectId = rest[0] || String(flags.options.project || "");
        const raw = rest[1] || String(flags.options.body || "");
        if (!projectId || !raw) throw new Error("Usage: fmotion command <projectId> '<json-envelope>'");
        const envelope = JSON.parse(raw) as Record<string, unknown>;
        print(await (await clientFromEnv()).command(projectId, envelope), flags.json);
        return 0;
      }
      case "render": {
        const projectId = rest[0] || String(flags.options.project || "");
        const kind = (rest[1] || flags.options.kind || "preview") as "preview" | "final";
        if (!projectId) throw new Error("Usage: fmotion render <projectId> [preview|final]");
        if (kind !== "preview" && kind !== "final") throw new Error("kind must be preview or final");
        print(await (await clientFromEnv()).render(projectId, kind), flags.json);
        return 0;
      }
      case "wait": {
        const jobId = rest[0] || String(flags.options.job || "");
        if (!jobId) throw new Error("Usage: fmotion wait <jobId>");
        const timeoutMs = flags.options.timeout ? Number(flags.options.timeout) * 1000 : undefined;
        print(await (await clientFromEnv()).wait(jobId, { timeoutMs }), flags.json);
        return 0;
      }
      case "download": {
        const jobId = rest[0] || String(flags.options.job || "");
        if (!jobId) throw new Error("Usage: fmotion download <jobId>");
        print(await (await clientFromEnv()).download(jobId), flags.json);
        return 0;
      }
      case "help":
      case undefined: {
        print(`fmotion — thin F-Motion /v1 client

Commands:
  login|config --api-key fm_… [--api-origin URL]
  usage
  projects list|create|get
  command <projectId> '<json-envelope>'
  render <projectId> [preview|final]
  wait <jobId> [--timeout seconds]
  download <jobId>

Global:
  --json    machine-readable output
`, false);
        return command ? 0 : 0;
      }
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const payload = error instanceof FmotionApiError
      ? { error: error.body.type || "api_error", message: error.message, status: error.status, details: error.body }
      : { error: "cli_error", message: error instanceof Error ? error.message : String(error) };
    if (flags.json) process.stderr.write(`${JSON.stringify(payload)}\n`);
    else process.stderr.write(`${payload.message}\n`);
    return exitCodeFor(error);
  }
}

const code = await main();
process.exitCode = code;
