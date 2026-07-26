import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium"
  },
  webServer: {
    command: "npm run dev --workspace apps/web -- --host 127.0.0.1 --port 4173",
    cwd: "../..",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false
  }
});
