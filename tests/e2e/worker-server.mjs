import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPreview } from "../../apps/worker/dist/index.js";

const directory = await mkdtemp(join(tmpdir(), "fengine-e2e-worker-"));
const results = new Map();
createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/jobs") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const job = JSON.parse(body);
    const output = join(directory, `${job.jobId}.mp4`);
    await renderPreview(
      output,
      undefined,
      undefined,
      {},
      { width: 720, height: 1280, watermark: "Reference preview" }
    );
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
