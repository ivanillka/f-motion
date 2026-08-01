import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium"
  },
  webServer: {
    command: "npm run build --workspace apps/api && npm run build --workspace apps/worker && node tests/e2e/run-servers.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false
  }
});
