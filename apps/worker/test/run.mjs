// ponytail: PATH-mutating ffprobe stubs race under default concurrency and
// overwrite fixtures; keep worker tests serial until probes take absolute bins.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const files = [
  "worker.test.mjs",
  "runtime.test.mjs",
  "fal-image.test.mjs",
  "fal-video.test.mjs",
  "queue.test.mjs",
  "queue-integration.test.mjs",
  ...(process.env.RUN_WORKER_INTEGRATION === "1" ? ["runtime-integration.test.mjs"] : [])
].map((name) => `${here}${name}`);

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  stdio: "inherit"
});
process.exit(result.status ?? 1);
