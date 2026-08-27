import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));

function gitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

process.env.VITE_GIT_SHA ??= gitSha();

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // One-image VPS serves the studio at / (Caddy redirects /app). Pages keeps /app/.
  base: process.env.VITE_SELFHOST_AUTH === "1" ? "/" : command === "build" ? "/app/" : "/",
  server: {
    fs: { allow: [searchForWorkspaceRoot(webRoot), resolve(webRoot, "../worker/assets/fonts")] },
    // Demo/e2e harness listens on 43140; durable stack uses :3000 via VITE_API_PROXY.
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:43140" }
  }
}));
