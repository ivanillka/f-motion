import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => ({
  plugins: [react()],
  // Public marketing at / /self-host /hosted; studio at /studio. Dev and
  // production share the same origin paths so e2e and self-host match.
  base: "/",
  server: {
    fs: { allow: [searchForWorkspaceRoot(webRoot), resolve(webRoot, "../worker/assets/fonts")] },
    // Demo/e2e harness listens on 43140; durable stack uses :3000 via VITE_API_PROXY.
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://127.0.0.1:43140" }
  }
}));
