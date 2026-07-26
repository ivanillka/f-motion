// ponytail: npm's trailing focus words are reporting labels until tests split.
await import("./domain.test.mjs");
await import("./auth-routes.test.mjs");
if (process.env.RUN_PROJECT_INTEGRATION === "1") await import("./project-persistence.test.mjs");
await import("./media-integration.test.mjs");
