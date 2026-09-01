import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));
const productVersion = JSON.parse(
  readFileSync(resolve(webRoot, "../../package.json"), "utf8")
).version as string;

function gitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

process.env.VITE_GIT_SHA ??= gitSha();
process.env.VITE_APP_VERSION ??= productVersion;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Self-host and f-motion.com SPA-at-root builds use /. Legacy artifact builds use /app/.
  base: process.env.VITE_SELFHOST_AUTH === "1" || process.env.VITE_SITE_AT_ROOT === "1"
    ? "/"
    : command === "build" ? "/app/" : "/",
  server: {
    fs: { allow: [searchForWorkspaceRoot(webRoot), resolve(webRoot, "../worker/assets/fonts")] },
    // Demo/e2e harness listens on 43140; durable stack uses :3000 via VITE_API_PROXY.
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:43140" }
  }
}));
