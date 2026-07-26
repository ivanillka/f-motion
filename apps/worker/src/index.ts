import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import type { ProjectSnapshot } from "@f-motion/contracts";
import { renderPlan } from "@f-motion/reel-engine";

export const renderPhases = ["queued", "preparing", "rendering", "uploading", "complete"] as const;

export function inspectMedia(declared: string, detected: string, bytes: number, maxBytes: number) {
  return { accepted: declared === detected && bytes > 0 && bytes <= maxBytes };
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

export function ffmpegArguments(snapshot: ProjectSnapshot, outputPath: string): string[] {
  const plan = renderPlan(snapshot);
  const duration = Math.max(0.2, plan.scenes.reduce((sum, scene) => sum + scene.duration_ms, 0) / 1000);
  const caption = plan.scenes[0]?.caption.trim();
  const filters = [
    "drawbox=x=24:y=ih-100:w=iw-48:h=64:color=black@0.65:t=fill",
    `drawtext=text='${escapedText(plan.watermark)}':x=(w-text_w)/2:y=h-78:fontcolor=white:fontsize=28`
  ];
  if (caption) {
    filters.unshift(`drawtext=text='${escapedText(caption)}':x=(w-text_w)/2:y=h-180:fontcolor=white:fontsize=36`);
  }
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=#202027:s=${plan.width}x${plan.height}:d=${duration}:r=30`,
    "-vf", filters.join(","),
    "-metadata", `comment=F-Motion project ${snapshot.id} revision ${snapshot.revision}`,
    "-c:v", "mpeg4",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath
  ];
}

export async function renderPreview(
  outputPath: string,
  snapshot?: ProjectSnapshot,
  signal?: AbortSignal
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
    await runFfmpeg(ffmpegArguments(snapshot ?? fallback, outputPath), signal);
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
