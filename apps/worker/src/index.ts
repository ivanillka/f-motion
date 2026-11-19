import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  stockBedCredit,
  stockBeds,
  type ProjectSnapshot
} from "@f-engine/contracts";
import {
  brandMarkOverlay,
  buildRenderPlanV1,
  photoFitTarget,
  type RenderPlanMediaDescriptor,
  type RenderProfile
} from "@f-engine/reel-engine";
import { compileRenderPlan, type RenderJob } from "./compile-plan.js";

// Re-exported so callers and tests keep one entry point for the compile step.
export { brandMarkOverlay };
export {
  buildCaptionAss,
  compileRenderPlan,
  concatArguments,
  sceneClipArguments
} from "./compile-plan.js";
export type {
  OverlayTextFit,
  RenderJob,
  RenderPlanAssets,
  RenderPlanCompileMetadata,
  RenderPlanCompileOptions,
  SceneClip
} from "./compile-plan.js";

export const renderPhases = ["queued", "preparing", "rendering", "uploading", "complete"] as const;

export const allowedProbeTypes = new Set(["video/mp4", "image/jpeg", "image/png", "image/webp"]);

export interface DetectedMedia {
  type: string;
  bytes: number;
  width?: number;
  height?: number;
  duration_ms?: number;
  has_audio?: boolean;
  video_codec?: string;
  pixel_format?: string;
  audio_codec?: string;
  audio_channels?: number;
}

export interface MediaInput {
  path: string;
  type: string;
  // undefined hasAudio assumes audio present (backward-compatible unit fixtures).
  hasAudio?: boolean;
  width?: number;
  height?: number;
}

export interface SoundtrackMix {
  path: string;
  level: number;
  offsetMs: number;
  title?: string;
  artist?: string;
  license?: string;
  sourceUrl?: string;
  creditUrl?: string;
}

export interface MediaLimits {
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  maxVideoDurationMs: number;
  probeTimeoutMs: number;
}

// ponytail: these ceilings cover 4K/16 MP phone and stock inputs and four
// maximum-length (15s) scenes. Upgrade by explicitly changing the matching
// MEDIA_* host configuration after profiling worker memory and render time.
export const defaultMediaLimits: MediaLimits = {
  maxWidth: 4096,
  maxHeight: 4096,
  maxPixels: 16_000_000,
  maxVideoDurationMs: 60_000,
  probeTimeoutMs: 10_000
};

const stillProbeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function declaredMatchesDetected(declared: string, detected: string): boolean {
  if (declared === detected) return true;
  // Partner/CDN stills often arrive as WebP with a JPEG content-type.
  return stillProbeTypes.has(declared) && stillProbeTypes.has(detected);
}

export function inspectMedia(
  declared: string,
  detected: DetectedMedia,
  maxBytes: number,
  limits: MediaLimits = defaultMediaLimits
): { accepted: boolean } {
  if (!allowedProbeTypes.has(detected.type) || !declaredMatchesDetected(declared, detected.type)) {
    return { accepted: false };
  }
  if (detected.bytes <= 0 || detected.bytes > maxBytes) return { accepted: false };
  if (!detected.width || detected.width <= 0 || !detected.height || detected.height <= 0) {
    return { accepted: false };
  }
  if (!Number.isInteger(detected.width) || !Number.isInteger(detected.height)
    || detected.width > limits.maxWidth || detected.height > limits.maxHeight
    || detected.width * detected.height > limits.maxPixels) {
    return { accepted: false };
  }
  if (detected.type === "video/mp4") {
    if (!detected.duration_ms || detected.duration_ms <= 0
      || detected.duration_ms > limits.maxVideoDurationMs) return { accepted: false };
  }
  return { accepted: true };
}

/**
 * Fitted size for a still that is over the media limits, or undefined when the
 * probe already fits or the media is not a still. Aspect ratio is kept and both
 * sides round down, so the result can never land back over a limit.
 */
export function stillScaleTarget(
  detected: Pick<DetectedMedia, "type" | "width" | "height">,
  limits: MediaLimits = defaultMediaLimits
): { width: number; height: number } | undefined {
  if (!stillProbeTypes.has(detected.type)) return undefined;
  if (!detected.width || !detected.height) return undefined;
  return photoFitTarget(detected.width, detected.height, limits);
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
  if (codec === "webp" || format.includes("webp")) return "image/webp";
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

export type MediaProbeErrorCode = "aborted" | "timeout" | "failed" | "invalid_output";

export class MediaProbeError extends Error {
  readonly name = "MediaProbeError";

  constructor(readonly code: MediaProbeErrorCode) {
    super(code === "aborted" ? "media probe aborted"
      : code === "timeout" ? "media probe timed out"
        : code === "invalid_output" ? "media probe returned invalid output"
          : "media probe failed");
  }
}

const MAX_PROBE_OUTPUT_BYTES = 1_000_000;
const PROBE_KILL_GRACE_MS = 1_000;

export async function probeMediaFile(
  path: string,
  signal?: AbortSignal,
  timeoutMs = defaultMediaLimits.probeTimeoutMs
): Promise<Omit<DetectedMedia, "bytes">> {
  if (signal?.aborted) throw new MediaProbeError("aborted");
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new MediaProbeError("failed");
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration,format_name:stream=codec_type,width,height,codec_name,pix_fmt,channels",
      "-of", "json",
      path
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    let spawnFailed = false;
    let termination: "aborted" | "timeout" | "failed" | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    child.stdout.setEncoding("utf8");
    const onData = (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_PROBE_OUTPUT_BYTES) terminate("failed");
    };
    const terminate = (reason: "aborted" | "timeout" | "failed") => {
      if (termination) return;
      termination = reason;
      stdout = "";
      child.stdout.off("data", onData);
      child.stdout.resume();
      if (child.kill("SIGTERM")) {
        killTimer = setTimeout(() => child.kill("SIGKILL"), PROBE_KILL_GRACE_MS);
        killTimer.unref();
      }
    };
    const onAbort = () => terminate("aborted");
    const timeout = setTimeout(() => terminate("timeout"), timeoutMs);
    timeout.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", onData);
    child.once("error", () => { spawnFailed = true; });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      child.stdout.off("data", onData);
      if (termination) reject(new MediaProbeError(termination));
      else if (spawnFailed || code !== 0) reject(new MediaProbeError("failed"));
      else resolve(stdout);
    });
  });
  type ProbeOutput = {
    format?: { duration?: string; format_name?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; channels?: number }>;
  };
  let parsed: ProbeOutput;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") throw new Error("invalid probe output");
    const candidate = value as ProbeOutput;
    if ((candidate.format !== undefined && (!candidate.format || typeof candidate.format !== "object"))
      || (candidate.streams !== undefined && !Array.isArray(candidate.streams))) {
      throw new Error("invalid probe output");
    }
    parsed = candidate;
  } catch {
    throw new MediaProbeError("invalid_output");
  }
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
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
  detected.has_audio = streams.some((stream) => stream.codec_type === "audio");
  if (video?.codec_name) detected.video_codec = video.codec_name;
  if (video?.pix_fmt) detected.pixel_format = video.pix_fmt;
  if (audio?.codec_name) detected.audio_codec = audio.codec_name;
  if (Number.isInteger(audio?.channels) && (audio?.channels ?? 0) > 0) detected.audio_channels = audio?.channels;
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

/**
 * Re-encode one oversized still at the fitted size and return the new path. The
 * encoding family follows the probed type so the stored content type stays
 * honest, and callers replace the original only after this resolves.
 */
export async function downscaleStillFile(
  source: string,
  target: { width: number; height: number },
  type: string,
  signal?: AbortSignal
): Promise<string> {
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const destination = `${source}.scaled.${extension}`;
  await runFfmpeg([
    "-y",
    "-v", "error",
    "-i", source,
    "-vf", `scale=${target.width}:${target.height}:flags=lanczos`,
    "-frames:v", "1",
    ...(type === "image/jpeg" ? ["-q:v", "3"] : []),
    destination
  ], signal);
  return destination;
}

const overlayFontsDir = fileURLToPath(new URL("../assets/fonts", import.meta.url));

/** Wordmark with the small tumbling cube beside it. Loop is the 36s splash tumble. */
export function brandMarkAssetPath(): string {
  return fileURLToPath(new URL("../assets/brand/f-motion-mark.webm", import.meta.url));
}

export function stockBedPath(id: string): string | undefined {
  const path = join(fileURLToPath(new URL("../assets/music", import.meta.url)), `${id}.mp3`);
  return existsSync(path) ? path : undefined;
}

export function resolveSoundtrackMix(
  snapshot: ProjectSnapshot,
  mediaInputs: Record<string, MediaInput>
): SoundtrackMix | undefined {
  const bed = snapshot.brief.soundtrack;
  if (!bed) return undefined;
  if (bed.kind === "upload") {
    const input = bed.media_id ? mediaInputs[bed.media_id] : undefined;
    if (!input) throw new Error("soundtrack media input missing");
    return { path: input.path, level: bed.level, offsetMs: bed.offset_ms };
  }
  const catalog = stockBeds.find((item) => item.id === bed.stock_id);
  const path = bed.stock_id ? stockBedPath(bed.stock_id) : undefined;
  if (!path) throw new Error("stock music bed missing");
  return {
    path,
    level: bed.level,
    offsetMs: bed.offset_ms,
    title: catalog?.title,
    artist: catalog?.artist,
    license: catalog?.license,
    sourceUrl: catalog?.sourceUrl,
    creditUrl: catalog && "creditUrl" in catalog ? catalog.creditUrl : undefined
  };
}

export function resolveVoiceoverMix(
  snapshot: ProjectSnapshot,
  mediaInputs: Record<string, MediaInput>
): SoundtrackMix | undefined {
  const vo = snapshot.brief.voiceover;
  if (!vo) return undefined;
  const input = mediaInputs[vo.media_id];
  if (!input) throw new Error("voiceover media input missing");
  return { path: input.path, level: vo.level, offsetMs: vo.offset_ms };
}

export function soundtrackMetadata(mix: SoundtrackMix): string[] {
  const credit = mix.artist && mix.title
    ? stockBedCredit({
      title: mix.title,
      artist: mix.artist,
      license: mix.license ?? "licensed",
      ...(mix.creditUrl ? { creditUrl: mix.creditUrl } : {})
    })
    : "Licensed soundtrack";
  return [
    ...(mix.title ? ["-metadata", `title=${mix.title}`] : []),
    ...(mix.artist ? ["-metadata", `artist=${mix.artist}`] : []),
    "-metadata", `copyright=${credit}`,
    ...(mix.sourceUrl ? ["-metadata", `comment=${mix.sourceUrl}`] : [])
  ];
}


/** Plan media descriptor for an input the renderer already holds. */
function mediaKindOf(input: MediaInput): RenderPlanMediaDescriptor["kind"] {
  return stillProbeTypes.has(input.type) ? "still" : "video";
}

/**
 * Build the render job for a snapshot through render plan v1. The snapshot is
 * only read by the plan builder: this function turns media inputs into plan
 * descriptors, resolves the plan's opaque refs to local files and hands the plan
 * to the compiler in `compile-plan.ts`.
 */
export function buildRenderJob(
  snapshot: ProjectSnapshot,
  outputPath: string,
  mediaInputs: Record<string, MediaInput>,
  tempDir: string,
  profile: RenderProfile
): RenderJob {
  const descriptors: Record<string, RenderPlanMediaDescriptor> = {};
  const media: Record<string, string> = {};
  for (const [id, input] of Object.entries(mediaInputs)) {
    descriptors[id] = {
      kind: mediaKindOf(input),
      ...(input.width ? { width: input.width } : {}),
      ...(input.height ? { height: input.height } : {}),
      ...(input.hasAudio === undefined ? {} : { has_audio: input.hasAudio })
    };
    media[id] = input.path;
  }
  const plan = buildRenderPlanV1(snapshot, profile, descriptors);
  // The licensed bed travels as an opaque `music:` ref, so its file comes from
  // the same mix resolution that supplies the credit tags below.
  const mix = resolveSoundtrackMix(snapshot, mediaInputs);
  if (plan.audio.bed && mix) media[plan.audio.bed.ref] = mix.path;
  return compileRenderPlan(plan, {
    media,
    brandMark: brandMarkAssetPath(),
    fontsDir: overlayFontsDir
  }, {
    tempDir,
    outputPath,
    metadata: {
      comment: `comment=project ${snapshot.id} revision ${snapshot.revision}`,
      ...(mix ? { soundtrack: soundtrackMetadata(mix) } : {})
    }
  });
}

export async function renderPreview(
  outputPath: string,
  snapshot?: ProjectSnapshot,
  signal?: AbortSignal,
  mediaInputs: Record<string, MediaInput> = {},
  profile?: RenderProfile
): Promise<void> {
  const fallback: ProjectSnapshot = {
    schema_version: 1,
    id: "fixture",
    owner_id: "fixture",
    revision: 0,
    brief: { purpose: "Fixture", audience: "Fixture", tone: "Neutral" },
    scenes: []
  };
  if (!profile) throw new Error("render profile required");
  const job = buildRenderJob(
    snapshot ?? fallback,
    outputPath,
    mediaInputs,
    dirname(outputPath),
    profile
  );
  try {
    for (const clip of job.clips) {
      if (clip.assPath && clip.assContents) await writeFile(clip.assPath, clip.assContents, "utf8");
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
      ...job.clips.map((clip) => clip.assPath ? unlink(clip.assPath).catch(() => undefined) : Promise.resolve()),
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
