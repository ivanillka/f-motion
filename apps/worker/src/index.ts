import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";

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

export async function renderPreview(outputPath: string, signal?: AbortSignal): Promise<void> {
  try {
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "color=c=#202027:s=720x1280:d=0.2",
      "-vf", "drawbox=x=24:y=1180:w=672:h=64:color=black@0.65:t=fill",
      "-c:v", "mpeg4", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath
    ], signal);
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
