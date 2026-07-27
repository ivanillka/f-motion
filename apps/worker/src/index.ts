import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
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

function escapeDrawtext(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

// ponytail: subtitles=PATH is a filter option, so ":" and "'" need the same
// escaping drawtext values do. Temp ASS paths come from our own outputPath
// (derived from mkdtemp callers), so this is defense in depth, not the
// primary guard.
function escapeFilterPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'");
}

// ponytail: ASS Dialogue text has no native escape for a literal "{"/"}"
// (they open override tags) or "\" (it can start \N/\n/\h codes). Swapping
// them for glyphs outside the base Latin font (e.g. fullwidth punctuation)
// makes libass select a fallback font mid-line, which visibly splits the
// BorderStyle=3 panel per font run — so the replacements below stay in the
// same font as the rest of the caption. Upgrade path: plan 015's timed-cue
// ASS builder should reuse this helper rather than re-deriving escaping rules.
function escapeAssText(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replaceAll("{", "(")
    .replaceAll("}", ")")
    .replace(/\r\n|\r|\n/g, "\\N");
}

const CAPTION_ASS_STYLE =
  "Style: Caption,DejaVu Sans,36,&H00FFFFFF,&H000000FF,&H00000000,&H40000000,0,0,0,0,100,100,0,0,3,2,0,2,40,40,140,1";

/**
 * Deterministic ASS subtitle document for the single static caption. Safe
 * area: PlayRes 720x1280, 40px side margins (640px max text width), text
 * bottom-anchored 140px above the frame bottom so it clears the watermark
 * band (which occupies the bottom ~100px) with a 40px gap. BorderStyle=3
 * renders BackColour as an opaque panel behind the text (~75% opacity).
 */
export function buildCaptionAss(caption: string): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 720",
    "PlayResY: 1280",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    CAPTION_ASS_STYLE,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,9:59:59.00,Caption,,0,0,0,,${escapeAssText(caption)}`,
    ""
  ].join("\n");
}

function overlayFilters(plan: ReturnType<typeof renderPlan>, captionAssPath?: string): string[] {
  const filters = [
    "drawbox=x=24:y=ih-100:w=iw-48:h=64:color=black@0.65:t=fill",
    `drawtext=text='${escapeDrawtext(plan.watermark)}':x=(w-text_w)/2:y=h-78:fontcolor=white:fontsize=28`
  ];
  if (captionAssPath) {
    filters.unshift(`subtitles=${escapeFilterPath(captionAssPath)}`);
  }
  return filters;
}

export function ffmpegArguments(
  snapshot: ProjectSnapshot,
  outputPath: string,
  mediaInputs: Record<string, MediaInput> = {},
  captionAssPath?: string
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
      ...overlayFilters(plan, captionAssPath)
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
    "-vf", overlayFilters(plan, captionAssPath).join(","),
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
  const plan = renderPlan(snapshot ?? fallback);
  const caption = plan.scenes[0]?.caption.trim() ?? "";
  const captionAssPath = caption ? `${outputPath}.caption.ass` : undefined;
  try {
    if (captionAssPath) await writeFile(captionAssPath, buildCaptionAss(caption), "utf8");
    await runFfmpeg(ffmpegArguments(snapshot ?? fallback, outputPath, mediaInputs, captionAssPath), signal);
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    if (captionAssPath) await unlink(captionAssPath).catch(() => undefined);
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
