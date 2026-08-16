import { spawn } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CaptionCue, ProjectSnapshot, Scene } from "@f-engine/contracts";
import {
  coverCropFilter,
  renderPlan,
  type RenderPlan,
  type RenderProfile
} from "@f-engine/reel-engine";

export const renderPhases = ["queued", "preparing", "rendering", "uploading", "complete"] as const;

export const allowedProbeTypes = new Set(["video/mp4", "image/jpeg", "image/png"]);

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

export function inspectMedia(
  declared: string,
  detected: DetectedMedia,
  maxBytes: number,
  limits: MediaLimits = defaultMediaLimits
): { accepted: boolean } {
  if (!allowedProbeTypes.has(detected.type) || detected.type !== declared) {
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
// them for same-font ASCII look-alikes avoids libass font-fallback panel seams.
function escapeAssText(value: string): string {
  return value
    .replaceAll("\\", "/")
    .replaceAll("{", "(")
    .replaceAll("}", ")")
    .replace(/\r\n|\r|\n/g, "\\N");
}

const MOTION_FPS = 30;
const MOTION_MAX_ZOOM = 1.08;

function motionFilter(motion: "none" | "push" | "zoom", durationSeconds: number, width: number, height: number): string | undefined {
  if (motion === "none") return undefined;
  const frames = Math.max(2, Math.round(durationSeconds * MOTION_FPS));
  if (motion === "zoom") {
    const step = (MOTION_MAX_ZOOM - 1) / (frames - 1);
    return `zoompan=z='min(zoom+${step.toFixed(6)},${MOTION_MAX_ZOOM})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${MOTION_FPS}`;
  }
  // ponytail: "push" is approximated as a small fixed-zoom horizontal pan rather than a
  // true directional push transition. Ceiling: this pan. Upgrade: a real motion-graph
  // per scene once multi-scene transitions land.
  return `zoompan=z=${MOTION_MAX_ZOOM}:x='(iw-iw/zoom)*on/${frames - 1}':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${MOTION_FPS}`;
}

const CAPTION_ASS_STYLE =
  "Style: Caption,DejaVu Sans,36,&H00FFFFFF,&H000000FF,&H00000000,&H40000000,0,0,0,0,100,100,0,0,3,2,0,2,40,40,140,1";

/** Formats milliseconds as an ASS timestamp: `h:mm:ss.cc` (centiseconds). */
function assTimestamp(ms: number): string {
  const centiseconds = Math.round(ms / 10);
  const hundredths = centiseconds % 100;
  const totalSeconds = Math.floor(centiseconds / 100);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/**
 * Deterministic ASS subtitle document with one `Dialogue` line per timed
 * cue. Safe area: PlayRes 720x1280, 40px side margins, text bottom-anchored
 * 140px above the frame bottom so it clears the watermark band.
 */
export function buildCaptionAss(cues: CaptionCue[]): string {
  const dialogues = cues.map((cue) =>
    `Dialogue: 0,${assTimestamp(cue.start_ms)},${assTimestamp(cue.end_ms)},Caption,,0,0,0,,${escapeAssText(cue.text)}`
  );
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
    ...dialogues,
    ""
  ].join("\n");
}

function vfArgs(filters: string[]): string[] {
  return filters.length ? ["-vf", filters.join(",")] : [];
}

function captionFilters(captionAssPath?: string): string[] {
  return captionAssPath ? [`subtitles=${escapeFilterPath(captionAssPath)}`] : [];
}

function watermarkFilters(watermark: string): string[] {
  return [
    "drawbox=x=24:y=ih-100:w=iw-48:h=64:color=black@0.65:t=fill",
    `drawtext=text='${escapeDrawtext(watermark)}':x=(w-text_w)/2:y=h-78:fontcolor=white:fontsize=28`
  ];
}

// `h264` lets FFmpeg select the available software encoder (libx264 in the
// production GPL build and OpenH264 in the local development image).
const clipVideoEncode = ["-c:v", "h264", "-b:v", "4M", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
const clipAudioEncode = ["-c:a", "aac", "-ar", "44100", "-ac", "2"];
const concatEncode = [...clipVideoEncode, ...clipAudioEncode];

// ponytail: ducking waits for a licensed music bed (Gate 0). scene.ducking is persisted but unused.
function audioFilterArgs(audioLevel: number): string[] {
  const level = Math.min(1, Math.max(0, audioLevel));
  return level === 1 ? [] : ["-af", `volume=${level}`];
}

function silentAudioInput(duration: number): string[] {
  return ["-f", "lavfi", "-t", String(duration), "-i", "anullsrc=r=44100:cl=stereo"];
}

function clipOutputArgs(videoMap: string, audioMap: string): string[] {
  return ["-map", videoMap, "-map", audioMap, ...clipVideoEncode, ...clipAudioEncode];
}

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
  plan: RenderPlan,
  scene: Scene,
  media: MediaInput | undefined,
  clipPath: string,
  captionAssPath?: string
): string[] {
  const duration = Math.max(0.2, scene.duration_ms / 1000);
  const captions = captionFilters(captionAssPath);
  const motion = motionFilter(scene.motion, duration, plan.width, plan.height);
  if (media) {
    const cover = [
      ...coverCropFilter(plan.width, plan.height, scene.focal_x, scene.focal_y),
      ...(motion ? [motion] : []),
      ...captions
    ];
    const still = media.type === "image/jpeg" || media.type === "image/png";
    const padAudio = still || media.hasAudio === false;
    const input = still
      ? ["-loop", "1", "-framerate", "30", "-t", String(duration), "-i", media.path]
      : ["-stream_loop", "-1", "-t", String(duration), "-i", media.path];
    const audioInput = padAudio ? silentAudioInput(duration) : [];
    const audioMap = padAudio ? "1:a" : "0:a";
    return [
      "-y",
      ...input,
      ...audioInput,
      ...vfArgs(cover),
      ...audioFilterArgs(scene.audio_level),
      ...clipOutputArgs("0:v", audioMap),
      clipPath
    ];
  }
  return [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=#202027:s=${plan.width}x${plan.height}:d=${duration}:r=30`,
    ...silentAudioInput(duration),
    ...vfArgs([...(motion ? [motion] : []), ...captions]),
    ...audioFilterArgs(scene.audio_level),
    ...clipOutputArgs("0:v", "1:a"),
    clipPath
  ];
}

export function concatArguments(
  listPath: string,
  plan: RenderPlan,
  snapshot: ProjectSnapshot,
  outputPath: string
): string[] {
  return [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    ...vfArgs(plan.watermark ? watermarkFilters(plan.watermark) : []),
    "-metadata", `comment=project ${snapshot.id} revision ${snapshot.revision}`,
    ...concatEncode,
    outputPath
  ];
}

export interface SceneClip {
  scene: Scene;
  path: string;
  args: string[];
  assPath?: string;
  assContents?: string;
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
  tempDir: string,
  profile: RenderProfile
): RenderJob {
  const plan = renderPlan(snapshot, profile);
  const scenes = plan.scenes.length
    ? [...plan.scenes].sort((a, b) => a.order - b.order)
    : [emptyScene];
  const clips = scenes.map((scene, index) => {
    // Gray lavfi is only for explicit unit fixtures (emptyScene / no media_id).
    // A declared media_id with no resolved input must fail closed, not substitute gray.
    if (scene.media_id && !mediaInputs[scene.media_id]) {
      throw new Error("scene media input missing");
    }
    const media = scene.media_id ? mediaInputs[scene.media_id] : undefined;
    const path = join(tempDir, `scene-${index}.mp4`);
    const cues = scene.caption_cues ?? [];
    const assPath = cues.length ? join(tempDir, `scene-${index}.ass`) : undefined;
    const assContents = cues.length ? buildCaptionAss(cues) : undefined;
    return {
      scene,
      path,
      assPath,
      assContents,
      args: sceneClipArguments(plan, scene, media, path, assPath)
    };
  });
  const listPath = join(tempDir, "concat-list.txt");
  const listContents = clips.map((clip) => concatListLine(clip.path)).join("");
  return { clips, listPath, listContents, concatArgs: concatArguments(listPath, plan, snapshot, outputPath) };
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
