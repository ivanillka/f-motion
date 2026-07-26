import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ProjectService } from "../../apps/api/dist/domain.js";
import { createTestApp } from "../../apps/api/dist/server.js";

const worker = spawn(process.execPath, ["tests/e2e/worker-server.mjs"], { stdio: "inherit" });
const projects = new ProjectService();
const completed = new Map();
const events = new Map();
const renders = {
  async create(ownerId, projectId) {
    const project = projects.get(ownerId, projectId);
    if (!project) return undefined;
    const jobId = randomUUID();
    events.set(jobId, true);
    const response = await fetch("http://127.0.0.1:43141/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, projectId, revision: project.revision })
    });
    if (!response.ok) throw new Error("test worker unavailable");
    completed.set(jobId, { jobId, objectKey: jobId, metadata: { immutable: true }, stale: false });
    return { jobId, ownerId, projectId, revision: project.revision, state: "complete" };
  },
  async cancel(ownerId, jobId) {
    if (!events.has(jobId)) return undefined;
    return { jobId, ownerId, projectId: "test", revision: 0, state: "cancelled" };
  },
  async events(ownerId, jobId, lastEventId) {
    if (!events.has(jobId)) return undefined;
    if (!lastEventId) return [{ eventId: "1", phase: "queued", percent: 0 }];
    if (lastEventId === "1") return [{ eventId: "2", phase: "rendering", percent: 72 }];
    if (lastEventId === "2") return [{ eventId: "3", phase: "complete", percent: 100 }];
    return [];
  },
  async result(ownerId, jobId) {
    return completed.get(jobId);
  }
};
const media = {
  store: { signedGet: async (jobId) => `http://127.0.0.1:43141/downloads/${jobId}` }
};
const api = createTestApp({ ownerId: "e2e-owner", projects, renders, media }).listen(43140, "127.0.0.1");
const web = spawn("npm", ["run", "dev", "--workspace", "apps/web", "--", "--host", "127.0.0.1", "--port", "4173"], { stdio: "inherit" });

const stop = () => {
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
  api.close(() => process.exit());
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
