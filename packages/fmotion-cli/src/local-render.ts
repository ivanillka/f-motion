import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { isProjectSnapshot, type ProjectSnapshot } from "@f-engine/contracts";
import {
  brandMarkAssetPath,
  buildRenderJob,
  captionFontsDir,
  ffmpegPath,
  ffprobePath,
  probeMediaFile,
  runRenderJob,
  type MediaInput,
  type RenderJob
} from "@f-engine/reference-worker/builder";
import type { RenderProfile } from "@f-engine/reel-engine";

export type LocalRenderProfileName = "preview" | "final";

/**
 * The two hosted profiles, mirroring the API's render defaults. A local export
 * must not invent arbitrary sizes: preview is the quick proof, final is the
 * 1080x1920 delivery frame.
 */
export const LOCAL_RENDER_PROFILES: Record<LocalRenderProfileName, RenderProfile> = {
  preview: { width: 540, height: 960 },
  final: { width: 1080, height: 1920 }
};

const sceneMediaTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4"]);
const captionFontFiles = ["Inter-SemiBold.ttf", "InterDisplay-ExtraBold.ttf"];

/** One media file, either resolved from `media/` or named in `mediaInputs`. */
export interface LocalRenderMedia {
  path: string;
  type?: string;
  hasAudio?: boolean;
  width?: number;
  height?: number;
}

/**
 * A snapshot plus the bytes it references. `mediaInputs` paths are relative to
 * the JSON file (or to the project directory for `snapshot.json`).
 */
export interface LocalRenderBundle {
  snapshot: ProjectSnapshot;
  mediaInputs?: Record<string, LocalRenderMedia>;
}

export interface LocalRenderInput {
  snapshot: ProjectSnapshot;
  mediaInputs: Record<string, MediaInput>;
  /** The file or directory the bundle came from, used in error messages. */
  source: string;
}

export interface LocalRenderOptions {
  output: string;
  profile?: LocalRenderProfileName;
  signal?: AbortSignal;
}

export interface LocalRenderResult {
  output: string;
  profile: LocalRenderProfileName;
  width: number;
  height: number;
  duration_ms: number;
  scenes: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveLocalRenderProfile(name?: string): LocalRenderProfileName {
  if (name === undefined || name === "final") return "final";
  if (name === "preview") return "preview";
  throw new Error("profile must be preview or final");
}

async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${message(error)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
}

function bundleFrom(value: unknown, source: string): LocalRenderBundle {
  if (isProjectSnapshot(value)) return { snapshot: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (isProjectSnapshot(record.snapshot)) {
      const mediaInputs = record.mediaInputs;
      if (mediaInputs !== undefined && (!mediaInputs || typeof mediaInputs !== "object" || Array.isArray(mediaInputs))) {
        throw new Error(`${source}: mediaInputs must be an object keyed by media id.`);
      }
      return {
        snapshot: record.snapshot,
        ...(mediaInputs === undefined ? {} : { mediaInputs: mediaInputs as Record<string, LocalRenderMedia> })
      };
    }
  }
  throw new Error(
    `${source} is not a project snapshot. Pass the worker snapshot JSON or { "snapshot": …, "mediaInputs": { … } }.`
  );
}

function mediaEntry(value: unknown, id: string): LocalRenderMedia | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`mediaInputs["${id}"] must be an object with a path.`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.path !== "string" || !record.path.trim()) {
    throw new Error(`mediaInputs["${id}"].path must be a file path.`);
  }
  if (record.type !== undefined && (typeof record.type !== "string" || !record.type)) {
    throw new Error(`mediaInputs["${id}"].type must be a media type.`);
  }
  return {
    path: record.path,
    ...(typeof record.type === "string" ? { type: record.type } : {}),
    ...(typeof record.hasAudio === "boolean" ? { hasAudio: record.hasAudio } : {}),
    ...(typeof record.width === "number" ? { width: record.width } : {}),
    ...(typeof record.height === "number" ? { height: record.height } : {})
  };
}

async function mediaFiles(mediaDir: string): Promise<Map<string, string>> {
  let names: string[];
  try {
    names = await readdir(mediaDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  return new Map(names.sort().map((name) => [name, join(mediaDir, name)]));
}

function fileForId(files: Map<string, string>, id: string): string | undefined {
  const exact = files.get(id);
  if (exact) return exact;
  for (const [name, path] of files) {
    if (name.startsWith(`${id}.`)) return path;
  }
  return undefined;
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`${label} is not a file: ${path}`);
  }
}

async function sourceFor(
  id: string,
  explicit: LocalRenderMedia | undefined,
  baseDir: string,
  mediaDir: string,
  files: Map<string, string>
): Promise<string> {
  const raw = explicit?.path;
  if (raw) {
    const path = isAbsolute(raw) ? raw : resolve(baseDir, raw);
    await assertFile(path, `mediaInputs["${id}"].path`);
    return path;
  }
  const found = fileForId(files, id);
  if (found) return found;
  throw new Error(
    `Missing media for ${id}. Add a file named ${id}.<ext> under ${mediaDir}, or list it in mediaInputs.`
  );
}

async function sceneMedia(
  path: string,
  explicit: LocalRenderMedia | undefined
): Promise<MediaInput> {
  let detected: Awaited<ReturnType<typeof probeMediaFile>>;
  try {
    detected = await probeMediaFile(path);
  } catch (error) {
    throw new Error(
      `Could not probe scene media ${path} with ffprobe (${message(error)}). Install FFmpeg or set FENGINE_FFPROBE_PATH.`
    );
  }
  const type = explicit?.type ?? detected.type;
  if (!sceneMediaTypes.has(type)) {
    throw new Error(`Scene media ${path} is ${type}. Use a JPEG, PNG, WebP, or MP4 file.`);
  }
  return {
    path,
    type,
    ...(detected.has_audio === undefined && explicit?.hasAudio === undefined
      ? {}
      : { hasAudio: explicit?.hasAudio ?? detected.has_audio }),
    ...(explicit?.width ?? detected.width ? { width: explicit?.width ?? detected.width } : {}),
    ...(explicit?.height ?? detected.height ? { height: explicit?.height ?? detected.height } : {})
  };
}

/**
 * Reads a project directory (`snapshot.json` plus `media/<media_id>.<ext>`) or
 * a snapshot JSON file. A JSON file may also wrap the snapshot as
 * `{ "snapshot": …, "mediaInputs": { "<media_id>": { "path": "media/x.jpg" } } }`,
 * with paths relative to that file.
 */
export async function loadLocalRenderInput(target: string): Promise<LocalRenderInput> {
  const resolved = resolve(target);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    throw new Error(
      `No project found at ${resolved}. Pass a project directory with snapshot.json or a snapshot JSON file.`
    );
  }
  if (!info.isDirectory() && extname(resolved).toLowerCase() !== ".json") {
    throw new Error(`${resolved} is not a project directory or a JSON snapshot.`);
  }
  const baseDir = info.isDirectory() ? resolved : dirname(resolved);
  const snapshotPath = info.isDirectory() ? join(resolved, "snapshot.json") : resolved;
  const bundle = bundleFrom(await readJsonFile(snapshotPath), snapshotPath);
  const mediaDir = join(baseDir, "media");
  const files = await mediaFiles(mediaDir);
  const mediaInputs: Record<string, MediaInput> = {};
  const sceneIds = [
    ...new Set(
      bundle.snapshot.scenes
        .map((scene) => scene.media_id)
        .filter((id): id is string => Boolean(id))
    )
  ];
  for (const id of sceneIds) {
    const explicit = mediaEntry(bundle.mediaInputs?.[id], id);
    const path = await sourceFor(id, explicit, baseDir, mediaDir, files);
    mediaInputs[id] = await sceneMedia(path, explicit);
  }
  const { soundtrack, voiceover } = bundle.snapshot.brief;
  const audioIds = [
    soundtrack?.kind === "upload" ? soundtrack.media_id : undefined,
    voiceover?.media_id
  ].filter((id): id is string => Boolean(id));
  for (const id of audioIds) {
    if (mediaInputs[id]) continue;
    const explicit = mediaEntry(bundle.mediaInputs?.[id], id);
    const path = await sourceFor(id, explicit, baseDir, mediaDir, files);
    mediaInputs[id] = { path, type: explicit?.type ?? "audio/mpeg" };
  }
  return { snapshot: bundle.snapshot, mediaInputs, source: snapshotPath };
}

async function assertBinary(binary: string, envName: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(binary, ["-version"], { stdio: "ignore" });
    child.once("error", () => reject(
      new Error(`${binary} is not available. Install FFmpeg or set ${envName} to the binary path.`)
    ));
    child.once("exit", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`${binary} exited ${code} for -version. Set ${envName} to a working binary.`)));
  });
}

/**
 * Fails before the first encoder spawn when FFmpeg, the caption fonts, the F-Motion
 * mark, or a referenced media file is missing. The server defaults stay on PATH.
 */
export async function assertLocalRenderReady(input: LocalRenderInput): Promise<void> {
  await assertBinary(ffmpegPath(), "FENGINE_FFMPEG_PATH");
  await assertBinary(ffprobePath(), "FENGINE_FFPROBE_PATH");
  const fontsDir = captionFontsDir();
  const missingFonts = captionFontFiles.filter((name) => !existsSync(join(fontsDir, name)));
  if (missingFonts.length) {
    throw new Error(
      `Caption fonts are missing from ${fontsDir}: ${missingFonts.join(", ")}. Reinstall the workspace so apps/worker/assets is present.`
    );
  }
  if (input.snapshot.brief.brand_mark && !existsSync(brandMarkAssetPath())) {
    throw new Error(
      `The F-Motion mark is missing at ${brandMarkAssetPath()}. Reinstall the workspace so apps/worker/assets is present.`
    );
  }
  for (const [id, media] of Object.entries(input.mediaInputs)) {
    if (!existsSync(media.path)) throw new Error(`Media ${id} is missing at ${media.path}.`);
  }
}

/** The worker job for a local export, built by the worker's own graph builders. */
export function buildLocalRenderJob(
  input: LocalRenderInput,
  profile: LocalRenderProfileName,
  outputPath: string,
  tempDir: string
): RenderJob {
  return buildRenderJob(
    input.snapshot,
    outputPath,
    input.mediaInputs,
    tempDir,
    LOCAL_RENDER_PROFILES[resolveLocalRenderProfile(profile)]
  );
}

/**
 * Renders a project through the worker's FFmpeg graph. The clip files are built
 * in a temporary directory next to the output, verified against the requested
 * profile, and only then moved into place, so a failed run never leaves a
 * partial MP4 at `options.output`.
 */
export async function renderLocal(
  input: LocalRenderInput,
  options: LocalRenderOptions
): Promise<LocalRenderResult> {
  const name = resolveLocalRenderProfile(options.profile);
  const profile = LOCAL_RENDER_PROFILES[name];
  await assertLocalRenderReady(input);
  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempDir = await mkdtemp(join(dirname(outputPath), ".fmotion-local-"));
  const rendered = join(tempDir, "render.mp4");
  try {
    let job: RenderJob;
    try {
      job = buildLocalRenderJob(input, name, rendered, tempDir);
    } catch (error) {
      throw new Error(`Cannot build the ${name} render from ${input.source}: ${message(error)}`);
    }
    await runRenderJob(job, rendered, options.signal);
    const measured = await probeMediaFile(rendered, options.signal);
    if (measured.width !== profile.width || measured.height !== profile.height) {
      throw new Error(
        `Rendered frame is ${measured.width ?? "?"}x${measured.height ?? "?"}, expected ${profile.width}x${profile.height}.`
      );
    }
    const plannedMs = job.clips.reduce((total, clip) => total + clip.scene.duration_ms, 0);
    if (Math.abs((measured.duration_ms ?? 0) - plannedMs) > 250) {
      throw new Error(`Rendered ${measured.duration_ms ?? 0}ms, expected about ${plannedMs}ms.`);
    }
    await rename(rendered, outputPath);
    return {
      output: outputPath,
      profile: name,
      width: profile.width,
      height: profile.height,
      duration_ms: measured.duration_ms ?? plannedMs,
      scenes: job.clips.length
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

