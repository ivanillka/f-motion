import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderJob, probeMediaFile, runRenderJob } from "@f-engine/reference-worker/builder";
import {
  LOCAL_RENDER_PROFILES,
  buildLocalRenderJob,
  loadLocalRenderInput,
  renderLocal,
  resolveLocalRenderProfile
} from "../dist/local-render.js";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const snapshot = {
  schema_version: 1,
  id: "local-project",
  owner_id: "owner",
  revision: 0,
  brief: { purpose: "Demo", audience: "Teams", tone: "Warm" },
  scenes: [{
    id: "scene-1",
    order: 0,
    media_id: "still",
    caption: "Local render",
    duration_ms: 1000,
    focal_x: 0.5,
    focal_y: 0.5,
    motion: "none",
    audio_level: 1,
    ducking: false
  }]
};

const ffmpeg = process.env.FENGINE_FFMPEG_PATH?.trim() || "ffmpeg";
const ffprobe = process.env.FENGINE_FFPROBE_PATH?.trim() || "ffprobe";
const hasFfmpeg = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0
  && spawnSync(ffprobe, ["-version"], { stdio: "ignore" }).status === 0;

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function frameAt(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      "-v", "error", "-ss", "0.2", "-i", file,
      "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => { chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 && chunks.length
      ? resolve(Buffer.concat(chunks))
      : reject(new Error(`ffmpeg frame extraction exited ${code}: ${stderr}`)));
  });
}

async function project({ wrapper = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "fmotion-cli-local-"));
  await mkdir(join(dir, "media"));
  await writeFile(join(dir, "media", "still.png"), png);
  const contents = wrapper
    ? { snapshot, mediaInputs: { still: { path: "media/still.png" } } }
    : snapshot;
  await writeFile(join(dir, "snapshot.json"), JSON.stringify(contents));
  return dir;
}

test("local profiles match the hosted render defaults", () => {
  assert.deepEqual(LOCAL_RENDER_PROFILES.preview, { width: 540, height: 960 });
  assert.deepEqual(LOCAL_RENDER_PROFILES.final, { width: 1080, height: 1920 });
  assert.equal(resolveLocalRenderProfile(), "final");
  assert.equal(resolveLocalRenderProfile("preview"), "preview");
  assert.throws(() => resolveLocalRenderProfile("huge"), /preview or final/);
});

test("the local job is byte-for-byte the worker job for the same profile", async () => {
  const dir = await project();
  try {
    const input = await loadLocalRenderInput(dir);
    const output = join(dir, "out.mp4");
    const local = buildLocalRenderJob(input, "preview", output, dir);
    const worker = buildRenderJob(input.snapshot, output, input.mediaInputs, dir, LOCAL_RENDER_PROFILES.preview);
    assert.deepEqual(local, worker);
    assert.equal(local.concatArgs.at(-1), output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a local render and a worker render produce the same first frame", {
  skip: hasFfmpeg ? false : "ffmpeg and ffprobe are not available"
}, async () => {
  const dir = await project();
  const workerDir = await mkdtemp(join(tmpdir(), "fmotion-worker-frame-"));
  try {
    const input = await loadLocalRenderInput(dir);
    const local = join(dir, "local.mp4");
    await renderLocal(input, { output: local, profile: "preview" });
    const worker = join(workerDir, "worker.mp4");
    const job = buildRenderJob(
      input.snapshot,
      worker,
      input.mediaInputs,
      workerDir,
      LOCAL_RENDER_PROFILES.preview
    );
    await runRenderJob(job, worker);
    assert.deepEqual(await frameAt(local), await frameAt(worker));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(workerDir, { recursive: true, force: true });
  }
});

test("a wrapped JSON bundle resolves media paths relative to the file", async () => {
  const dir = await project({ wrapper: true });
  try {
    const input = await loadLocalRenderInput(join(dir, "snapshot.json"));
    assert.equal(input.mediaInputs.still?.path, join(dir, "media", "still.png"));
    assert.equal(input.mediaInputs.still?.type, "image/png");
    assert.equal(input.source, join(dir, "snapshot.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a declared scene without media fails before the encoder starts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fmotion-cli-missing-"));
  try {
    await writeFile(join(dir, "snapshot.json"), JSON.stringify(snapshot));
    await assert.rejects(() => loadLocalRenderInput(dir), (error) => {
      assert.match(error.message, /Missing media for still/);
      assert.match(error.message, new RegExp(join(dir, "media")));
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("render-local validates the profile and output before touching media", async () => {
  const badProfile = await runCli([
    "render-local", "/does/not/exist", "-o", "out.mp4", "--profile", "huge", "--json"
  ]);
  assert.equal(badProfile.code, 1);
  assert.match(JSON.parse(badProfile.stderr).message, /preview or final/);

  const noOutput = await runCli(["render-local", "/does/not/exist", "--json"]);
  assert.equal(noOutput.code, 1);
  assert.match(JSON.parse(noOutput.stderr).message, /Usage: fmotion render-local/);
});

test("render-local renders a project directory through the worker graph", {
  skip: hasFfmpeg ? false : "ffmpeg and ffprobe are not available"
}, async () => {
  const dir = await project({ wrapper: true });
  const output = join(dir, "out.mp4");
  try {
    const result = await runCli([
      "render-local", dir, "-o", output, "--profile", "preview", "--json"
    ]);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.profile, "preview");
    assert.equal(body.width, 540);
    assert.equal(body.height, 960);
    assert.equal(body.scenes, 1);
    assert.ok(body.duration_ms >= 1000 && body.duration_ms <= 1250);
    assert.ok((await stat(output)).size > 0);
    const probed = await probeMediaFile(output);
    assert.equal(probed.width, 540);
    assert.equal(probed.height, 960);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderLocal verifies the requested frame before publishing the file", {
  skip: hasFfmpeg ? false : "ffmpeg and ffprobe are not available"
}, async () => {
  const dir = await project();
  const output = join(dir, "final.mp4");
  try {
    const input = await loadLocalRenderInput(dir);
    const result = await renderLocal(input, { output, profile: "final" });
    assert.equal(result.profile, "final");
    assert.equal(result.width, 1080);
    assert.equal(result.height, 1920);
    const probed = await probeMediaFile(output);
    assert.equal(probed.width, 1080);
    assert.equal(probed.height, 1920);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

