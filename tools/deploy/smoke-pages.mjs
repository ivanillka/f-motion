import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseSmokeArgs(args) {
  let originValue;
  let timeoutMs = 10_000;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--timeout-ms") {
      const value = args[index + 1];
      index += 1;
      timeoutMs = Number(value);
    } else if (originValue === undefined) {
      originValue = argument;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer");
  }

  let origin;
  try {
    origin = new URL(originValue);
  } catch {
    throw new Error("An explicit HTTPS origin is required");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password
    || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Origin must be an HTTPS origin without credentials, path, query, or fragment");
  }

  return { origin: origin.origin, timeoutMs };
}

export async function smokePages({ origin, timeoutMs }, fetchImpl = globalThis.fetch) {
  const url = new URL("/api/healthz", origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Pages smoke timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Pages smoke request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Pages health endpoint returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const isJson = contentType === "application/json"
    || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(contentType || "");
  if (!isJson) {
    throw new Error(`Pages health endpoint returned non-JSON content-type: ${contentType || "missing"}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Pages health endpoint returned invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.status !== "ok") {
    throw new Error('Pages health endpoint JSON must contain {"status":"ok"}');
  }

  return url.href;
}

async function main() {
  const options = parseSmokeArgs(process.argv.slice(2));
  const url = await smokePages(options);
  console.log(`Pages proxy smoke passed: ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
