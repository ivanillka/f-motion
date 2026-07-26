import { spawn } from "node:child_process";
import { createApp } from "../../apps/api/dist/server.js";

const worker = spawn(process.execPath, ["tests/e2e/worker-server.mjs"], { stdio: "inherit" });
const api = createApp(() => true, "http://127.0.0.1:43141").listen(43140, "127.0.0.1");
const web = spawn("npm", ["run", "dev", "--workspace", "apps/web", "--", "--host", "127.0.0.1", "--port", "4173"], { stdio: "inherit" });

const stop = () => {
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
  api.close(() => process.exit());
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
