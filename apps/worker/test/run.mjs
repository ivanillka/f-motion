// ponytail: npm's trailing focus words are reporting labels until tests split.
await import("./worker.test.mjs");
await import("./runtime.test.mjs");
await import("./fal-image.test.mjs");
await import("./queue.test.mjs");
await import("./queue-integration.test.mjs");
if (process.env.RUN_WORKER_INTEGRATION === "1") await import("./runtime-integration.test.mjs");
