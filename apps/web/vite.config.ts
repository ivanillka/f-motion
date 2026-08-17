import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Production: studio under /app/; marketing owns /. Dev stays at / for e2e.
  base: command === "build" ? "/app/" : "/",
  server: {
    fs: { allow: [searchForWorkspaceRoot(webRoot), resolve(webRoot, "../worker/assets/fonts")] },
    // Demo/e2e harness listens on 43140; durable stack uses :3000 via VITE_API_PROXY.
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:43140" }
  }
}));
