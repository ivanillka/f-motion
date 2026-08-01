import { createServer } from "node:http";
import { mkdtemp, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isProjectSnapshot } from "../../packages/contracts/dist/index.js";
import { renderPreview } from "../../apps/worker/dist/index.js";
import { validateRenderProfile } from "../../packages/reel-engine/dist/index.js";

const directory = await mkdtemp(join(tmpdir(), "fengine-e2e-worker-"));
const fixtureDirectory = await realpath(fileURLToPath(new URL("../../apps/worker/test/fixtures/", import.meta.url)));
const results = new Map();

async function validatedJob(body) {
  const job = JSON.parse(body);
  if (!job || typeof job !== "object" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(job.jobId)) {
    throw new Error("invalid job identity");
  }
  if (!isProjectSnapshot(job.snapshot) || job.snapshot.scenes.length === 0) {
    throw new Error("invalid project snapshot");
  }
  if (!job.mediaInputs || typeof job.mediaInputs !== "object" || Array.isArray(job.mediaInputs)) {
    throw new Error("invalid media inputs");
  }
  if (!(["preview", "final"].includes(job.kind))) throw new Error("invalid render kind");
  job.renderProfile = validateRenderProfile(job.renderProfile);
  const mediaInputs = {};
  for (const scene of job.snapshot.scenes) {
    if (!scene.media_id) continue;
    const descriptor = job.mediaInputs[scene.media_id];
    if (!descriptor || typeof descriptor.path !== "string"
      || !["video/mp4", "image/jpeg", "image/png"].includes(descriptor.type)) {
      throw new Error(`missing media input for scene ${scene.id}`);
    }
    const path = await realpath(descriptor.path);
    const fixtureRelative = relative(fixtureDirectory, path);
    if (!fixtureRelative || fixtureRelative.startsWith("..") || isAbsolute(fixtureRelative)) {
      throw new Error("media input escaped fixture directory");
    }
    mediaInputs[scene.media_id] = {
      path,
      type: descriptor.type,
      ...(typeof descriptor.hasAudio === "boolean" ? { hasAudio: descriptor.hasAudio } : {})
    };
  }
  return { ...job, mediaInputs };
}

createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/jobs") {
    let body = "";
    for await (const chunk of request) body += chunk;
    let job;
    try {
      job = await validatedJob(body);
    } catch (error) {
      response.statusCode = 400;
      return response.end(error instanceof Error ? error.message : "invalid job");
    }
    const output = join(directory, `${job.jobId}.mp4`);
    try {
      await renderPreview(
        output,
        job.snapshot,
        undefined,
        job.mediaInputs,
        job.renderProfile
      );
    } catch (error) {
      response.statusCode = 500;
      return response.end(error instanceof Error ? error.message : "render failed");
    }
    results.set(job.jobId, output);
    response.setHeader("content-type", "application/json");
    return response.end(JSON.stringify({
      jobId: job.jobId,
      revision: job.revision,
      immutable: true,
      downloadUrl: `/api/download/${job.jobId}`
    }));
  }
  const match = request.url?.match(/^\/downloads\/([^/]+)$/);
  if (match && results.has(match[1])) {
    response.setHeader("content-type", "video/mp4");
    return createReadStream(results.get(match[1])).pipe(response);
  }
  response.statusCode = 404;
  response.end();
}).listen(43141, "127.0.0.1");
