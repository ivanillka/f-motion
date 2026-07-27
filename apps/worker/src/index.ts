import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import type { ProjectSnapshot } from "@f-motion/contracts";
import { renderPlan } from "@f-motion/reel-engine";

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

function overlayFilters(plan: ReturnType<typeof renderPlan>): string[] {
  const caption = plan.scenes[0]?.caption.trim();
  const filters = [
    "drawbox=x=24:y=ih-100:w=iw-48:h=64:color=black@0.65:t=fill",
    `drawtext=text='${escapedText(plan.watermark)}':x=(w-text_w)/2:y=h-78:fontcolor=white:fontsize=28`
  ];
  if (caption) {
    filters.unshift(`drawtext=text='${escapedText(caption)}':x=(w-text_w)/2:y=h-180:fontcolor=white:fontsize=36`);
  }
  return filters;
}

export function ffmpegArguments(
  snapshot: ProjectSnapshot,
  outputPath: string,
  mediaInputs: Record<string, MediaInput> = {}
): string[] {
  const plan = renderPlan(snapshot);
  const scene = plan.scenes[0];
  const duration = Math.max(0.2, plan.scenes.reduce((sum, item) => sum + item.duration_ms, 0) / 1000);
  const media = scene?.media_id ? mediaInputs[scene.media_id] : undefined;
  const encode = [
    "-metadata", `comment=F-Motion project ${snapshot.id} revision ${snapshot.revision}`,
    "-c:v", "mpeg4",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    outputPath
  ];

  // ponytail: first scene with media only. Ceiling: single input. Upgrade: multi-scene concat.
  if (media) {
    const cover = [
      `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase`,
      `crop=${plan.width}:${plan.height}`,
      ...overlayFilters(plan)
    ];
    const still = media.type === "image/jpeg" || media.type === "image/png";
    const input = still
      ? ["-loop", "1", "-framerate", "30", "-t", String(duration), "-i", media.path]
      : ["-t", String(duration), "-i", media.path];
    return ["-y", ...input, "-vf", cover.join(","), ...encode];
  }

  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=#202027:s=${plan.width}x${plan.height}:d=${duration}:r=30`,
    "-vf", overlayFilters(plan).join(","),
    ...encode
  ];
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
  try {
    await runFfmpeg(ffmpegArguments(snapshot ?? fallback, outputPath, mediaInputs), signal);
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
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
