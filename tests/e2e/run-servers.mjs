import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ProjectService } from "../../apps/api/dist/domain.js";
import { createTestApp } from "../../apps/api/dist/server.js";

const videoFixture = fileURLToPath(new URL("../../apps/worker/test/fixtures/scene_one.mp4", import.meta.url));
const imageFixture = fileURLToPath(new URL("../../apps/worker/test/fixtures/still.jpg", import.meta.url));
const worker = spawn(process.execPath, ["tests/e2e/worker-server.mjs"], { stdio: "inherit" });
const projects = new ProjectService();
const completed = new Map();
const events = new Map();
const mediaAssets = new Map();
const inspectionPolls = new Map();
const renders = {
  async create(ownerId, projectId, kind) {
    const project = projects.get(ownerId, projectId);
    if (!project) return undefined;
    const mediaInputs = {};
    for (const scene of project.scenes) {
      if (!scene.media_id) continue;
      const asset = mediaAssets.get(scene.media_id);
      if (!asset || asset.ownerId !== ownerId || asset.projectId !== projectId || asset.state !== "ready") {
        throw new Error(`test fixture unavailable for scene ${scene.id}`);
      }
      if (asset.declaredType === "video/mp4") {
        mediaInputs[asset.id] = { path: videoFixture, type: asset.declaredType, hasAudio: true };
      } else if (asset.declaredType === "image/jpeg") {
        mediaInputs[asset.id] = { path: imageFixture, type: asset.declaredType };
      } else {
        throw new Error(`unsupported test fixture type ${asset.declaredType}`);
      }
    }
    const jobId = randomUUID();
    const renderProfile = kind === "final" ? { width: 720, height: 1280 } : { width: 540, height: 960, watermark: "Reference preview" };
    events.set(jobId, true);
    const response = await fetch("http://127.0.0.1:43141/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, projectId, revision: project.revision, kind, renderProfile, snapshot: project, mediaInputs })
    });
    if (!response.ok) throw new Error("test worker unavailable");
    completed.set(jobId, { jobId, objectKey: jobId, kind, metadata: { ...renderProfile, duration_ms: project.scenes.reduce((sum, scene) => sum + scene.duration_ms, 0) }, stale: false });
    return { jobId, ownerId, projectId, revision: project.revision, kind, renderProfile, state: "complete" };
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
const mediaRepository = {
  async insert(asset) {
    mediaAssets.set(asset.id, structuredClone(asset));
  },
  async get(ownerId, projectId, id) {
    const asset = mediaAssets.get(id);
    if (!asset || asset.ownerId !== ownerId || asset.projectId !== projectId) return undefined;
    const snapshot = structuredClone(asset);
    if (asset.state === "inspecting" && !inspectionPolls.has(id)) {
      inspectionPolls.set(id, 1);
      asset.state = "ready";
      asset.detected = { type: asset.declaredType, bytes: asset.maxBytes };
    }
    return snapshot;
  },
  async completeAdmission(ownerId, projectId, id) {
    const asset = mediaAssets.get(id);
    if (!asset || asset.ownerId !== ownerId || asset.projectId !== projectId) return false;
    asset.state = "inspecting";
    return true;
  }
};
const pexelsResults = [
  {
    id: 101,
    creator: "Fixture One",
    attributionUrl: "https://www.pexels.com/video/101",
    previewUrl: "https://e2e-images.invalid/101.jpg",
    sourceUrl: "https://e2e-media.invalid/101.mp4",
    contentType: "video/mp4"
  },
  {
    id: 102,
    creator: "Fixture Two With A Long Name",
    attributionUrl: "https://www.pexels.com/video/102",
    previewUrl: "https://e2e-images.invalid/102.jpg",
    sourceUrl: "https://e2e-media.invalid/102.mp4",
    contentType: "video/mp4"
  }
];
const media = {
  repository: mediaRepository,
  store: {
    async signedPut(objectKey) {
      return `https://e2e-storage.invalid/${encodeURIComponent(objectKey)}`;
    },
    async exists() {
      return true;
    },
    async put() {},
    async signedGet(jobId) {
      return `http://127.0.0.1:43141/downloads/${jobId}`;
    }
  },
  pexels: {
    async search(query) {
      const results = query.includes("mountain") ? [...pexelsResults].reverse() : pexelsResults;
      return structuredClone(results);
    },
    async copy(ownerId, projectId, selected, repository) {
      const asset = {
        id: randomUUID(),
        ownerId,
        projectId,
        objectKey: `projects/${projectId}/media/pexels-${selected.id}`,
        state: "inspecting",
        declaredType: selected.contentType,
        maxBytes: 4096,
        attribution: {
          source: "Pexels",
          creator: selected.creator,
          url: selected.attributionUrl,
          previewUrl: selected.previewUrl
        }
      };
      await repository.insert(asset);
      return asset;
    }
  }
};
const pexelsCredentials = {
  async status() { return { provider: "pexels", connected: true, hint: "1234" }; },
  async connect() { return { provider: "pexels", connected: true, hint: "1234" }; },
  async test() { return { provider: "pexels", connected: true, hint: "1234" }; },
  async disconnect() {},
  async client() { return media.pexels; }
};
const api = createTestApp({ ownerId: "e2e-owner", projects, renders, media, pexelsCredentials }).listen(43140, "127.0.0.1");
const web = spawn("npm", ["run", "dev", "--workspace", "apps/web", "--", "--host", "127.0.0.1", "--port", "4173"], { stdio: "inherit" });

const stop = () => {
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
  api.close(() => process.exit());
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
