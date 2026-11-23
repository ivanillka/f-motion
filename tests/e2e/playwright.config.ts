import { defineConfig } from "@playwright/test";

// CI gets one retry and a fixed small worker count so a rerun is predictable.
// Local runs keep zero retries so a flake stays visible while it is developed.
const ci = Boolean(process.env.CI);

// The raster gate is the only spec that renders a final video through FFmpeg
// twice. Keeping it in its own project means a failure names that gate instead
// of surfacing as a generic web-flow failure.
const GOLDEN_TITLE = /golden frames match between the studio preview and the worker export/;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 300_000,
  expect: { timeout: 60_000 },
  retries: ci ? 1 : 0,
  ...(ci ? { workers: 2 } : {}),
  projects: [
    {
      name: "studio",
      grepInvert: GOLDEN_TITLE
    },
    {
      name: "golden",
      grep: GOLDEN_TITLE
    }
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium"
  },
  webServer: {
    command: "npm run build --workspace apps/api && npm run build --workspace apps/worker && node tests/e2e/run-servers.mjs",
    cwd: "../..",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 180_000
  }
});