import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProjectSnapshot, Scene } from "@f-motion/contracts";
import { coverCropFilter, renderPlan } from "@f-motion/reel-engine";

export const renderPhases = ["queued", "preparing", "rendering", "uploading", "complete"] as const;

export const allowedProbeTypes = new Set(["video/mp4", "image/jpeg", "image/png"]);

export interface DetectedMedia {
  type: string;
  bytes: number;
  width?: number;
  height?: number;
  duration_ms?: number;
}

export interface MediaInput {
  path: string;
  type: string;
}

export function inspectMedia(
  declared: string,
  detected: DetectedMedia,
  maxBytes: number
): { accepted: boolean } {
  if (!allowedProbeTypes.has(detected.type) || detected.type !== declared) {
    return { accepted: false };
  }
  if (detected.bytes <= 0 || detected.bytes > maxBytes) return { accepted: false };
  if (!detected.width || detected.width <= 0 || !detected.height || detected.height <= 0) {
    return { accepted: false };
  }
  if (detected.type === "video/mp4") {
    if (!detected.duration_ms || detected.duration_ms <= 0) return { accepted: false };
  }
  return { accepted: true };
}

function mimeFromProbe(
  formatName: string,
  streams: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>
): string {
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) return "application/octet-stream";
  const codec = video.codec_name ?? "";
  const format = formatName.toLowerCase();
  if (codec === "png" || format.includes("png")) return "image/png";
  if (codec === "mjpeg" || codec === "jpeg" || format.includes("jpeg") || format.includes("mjpeg")) {
    if (!format.includes("mp4") && !format.includes("mov") && !format.includes("ismv")) {
      return "image/jpeg";
    }
  }
  if (format.includes("mp4") || format.includes("mov") || format.includes("ismv")
    || ["h264", "hevc", "mpeg4", "av1", "vp9"].includes(codec)) {
    return "video/mp4";
  }
  return "application/octet-stream";
}

export async function probeMediaFile(path: string): Promise<Omit<DetectedMedia, "bytes">> {
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration,format_name:stream=codec_type,width,height,codec_name",
      "-of", "json",
      path
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exited ${code}`));
    });
  });
  const parsed = JSON.parse(raw) as {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const type = mimeFromProbe(parsed.format?.format_name ?? "", streams);
  const width = video?.width;
  const height = video?.height;
  const durationSeconds = Number(parsed.format?.duration);
  const detected: Omit<DetectedMedia, "bytes"> = { type };
  if (width && height) {
    detected.width = width;
    detected.height = height;
  }
  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    detected.duration_ms = Math.round(durationSeconds * 1000);
  }
  return detected;
}

export function renderObjectKey(projectId: string, revision: number) {
  return `projects/${projectId}/renders/${revision}.mp4`;
}

export async function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: "ignore", signal });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
}

function escapedText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

function vfArgs(filters: string[]): string[] {
  return filters.length ? ["-vf", filters.join(",")] : [];
}

function captionFilter(scene: Scene): string[] {
  const caption = scene.caption.trim();
  return caption
    ? [`drawtext=text='${escapedText(caption)}':x=(w-text_w)/2:y=h-180:fontcolor=white:fontsize=36`]
    : [];
}

function watermarkFilters(watermark: string): string[] {
  return [
    "drawbox=x=24:y=ih-100:w=iw-48:h=64:color=black@0.65:t=fill",
    `drawtext=text='${escapedText(watermark)}':x=(w-text_w)/2:y=h-78:fontcolor=white:fontsize=28`
  ];
}

const clipEncode = ["-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];

// Fallback for renderPreview() called without a snapshot (local demo fixture only).
const emptyScene: Scene = {
  id: "empty",
  order: 0,
  caption: "",
  duration_ms: 200,
  focal_x: 0.5,
  focal_y: 0.5,
  motion: "none",
  audio_level: 1,
  ducking: false
};

export function sceneClipArguments(
  plan: ReturnType<typeof renderPlan>,
  scene: Scene,
  media: MediaInput | undefined,
  clipPath: string
): string[] {
  const duration = Math.max(0.2, scene.duration_ms / 1000);
  if (media) {
    const cover = [
      ...coverCropFilter(plan.width, plan.height, scene.focal_x, scene.focal_y),
      ...captionFilter(scene)
    ];
    const still = media.type === "image/jpeg" || media.type === "image/png";
    const input = still
      ? ["-loop", "1", "-framerate", "30", "-t", String(duration), "-i", media.path]
      : ["-t", String(duration), "-i", media.path];
    return ["-y", ...input, ...vfArgs(cover), ...clipEncode, clipPath];
  }
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=#202027:s=${plan.width}x${plan.height}:d=${duration}:r=30`,
    ...vfArgs(captionFilter(scene)),
    ...clipEncode,
    clipPath
  ];
}

export function concatArguments(
  listPath: string,
  plan: ReturnType<typeof renderPlan>,
  snapshot: ProjectSnapshot,
  outputPath: string
): string[] {
  return [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    ...vfArgs(watermarkFilters(plan.watermark)),
    "-metadata", `comment=F-Motion project ${snapshot.id} revision ${snapshot.revision}`,
    ...clipEncode,
    outputPath
  ];
}

export interface SceneClip {
  scene: Scene;
  path: string;
  args: string[];
}

export interface RenderJob {
  clips: SceneClip[];
  listPath: string;
  listContents: string;
  concatArgs: string[];
}

function concatListLine(clipPath: string): string {
  return `file '${clipPath.replaceAll("'", "'\\''")}'\n`;
}

export function buildRenderJob(
  snapshot: ProjectSnapshot,
  outputPath: string,
  mediaInputs: Record<string, MediaInput>,
  tempDir: string
): RenderJob {
  const plan = renderPlan(snapshot);
  const scenes = plan.scenes.length
    ? [...plan.scenes].sort((a, b) => a.order - b.order)
    : [emptyScene];
  const clips = scenes.map((scene, index) => {
    const media = scene.media_id ? mediaInputs[scene.media_id] : undefined;
    const path = join(tempDir, `scene-${index}.mp4`);
    return { scene, path, args: sceneClipArguments(plan, scene, media, path) };
  });
  const listPath = join(tempDir, "concat-list.txt");
  const listContents = clips.map((clip) => concatListLine(clip.path)).join("");
  return { clips, listPath, listContents, concatArgs: concatArguments(listPath, plan, snapshot, outputPath) };
}

export async function renderPreview(
  outputPath: string,
  snapshot?: ProjectSnapshot,
  signal?: AbortSignal,
  mediaInputs: Record<string, MediaInput> = {}
): Promise<void> {
  const fallback: ProjectSnapshot = {
    schema_version: 1,
    id: "fixture",
    owner_id: "fixture",
    revision: 0,
    brief: { purpose: "Fixture", audience: "Fixture", tone: "Neutral" },
    scenes: []
  };
  const job = buildRenderJob(snapshot ?? fallback, outputPath, mediaInputs, dirname(outputPath));
  try {
    for (const clip of job.clips) {
      await runFfmpeg(clip.args, signal);
    }
    await writeFile(job.listPath, job.listContents);
    await runFfmpeg(job.concatArgs, signal);
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    await Promise.all([
      ...job.clips.map((clip) => unlink(clip.path).catch(() => undefined)),
      unlink(job.listPath).catch(() => undefined)
    ]);
  }
}

export class IdempotentResults {
  readonly #results = new Map<string, Readonly<Record<string, unknown>>>();
  complete(key: string, value: Record<string, unknown>) {
    const existing = this.#results.get(key);
    if (existing) return existing;
    const immutable = Object.freeze(structuredClone(value));
    this.#results.set(key, immutable);
    return immutable;
  }
}
