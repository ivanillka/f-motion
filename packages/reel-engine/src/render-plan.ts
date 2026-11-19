import { overlayLooks, overlayPlaces, type OverlayLook, type OverlayPlace } from "@f-engine/contracts";

/**
 * Platform-neutral render plan v1. This is the whole contract between whoever
 * decides what a reel is (the engine) and whoever draws it (the worker today,
 * the phone in this spike):
 *
 * - every number the renderer used to hard-code lives here: zoom range, pan
 *   scale, easing sample density, brand mark geometry, duck gain and the
 *   encode settings;
 * - media is referenced by opaque `ref` strings the renderer resolves on its
 *   own device, so a plan never carries a server path, a URL or a bucket key;
 * - the plan is a pure function of the snapshot, the profile and media
 *   descriptors, so the server and the phone build the same bytes.
 *
 * The JSON schema mirrors this file at
 * `packages/contracts/schema/render-plan-v1.schema.json`, and the Dart reader
 * at `apps/mobile/lib/render/plan.dart` accepts exactly this shape.
 */
export const RENDER_PLAN_SCHEMA = "fmotion.render-plan" as const;
export const RENDER_PLAN_VERSION = 1 as const;

/** Asset id the renderer resolves to its own copy of the brand mark. */
export const RENDER_PLAN_BRAND_MARK_REF = "brand_mark";

/** Frame rate every renderer emits; the plan carries it so it can be checked. */
export const RENDER_PLAN_FPS = 30;

/**
 * Encoder settings both renderers target: H.264 8 Mbit, yuv420p, AAC stereo
 * at 44.1 kHz. Values are what the worker already passes, so a plan compiled
 * by either renderer names the same container.
 */
export const RENDER_PLAN_ENCODE_DEFAULTS: RenderPlanEncode = {
  video: "h264",
  video_bitrate: "8M",
  pixel_format: "yuv420p",
  audio: "aac",
  audio_rate: 44100,
  audio_channels: 2
};

/**
 * Overlay fonts every renderer must ship and burn with. These are the faces
 * the worker asset directory carries and the app bundles: Inter Display
 * ExtraBold titles, Inter SemiBold captions.
 */
export const RENDER_PLAN_FONTS = {
  title: "Inter Display ExtraBold",
  caption: "Inter SemiBold"
} as const;

/** Catalog beds travel as `music:<stock id>` so no path crosses the seam. */
const RENDER_PLAN_MUSIC_PREFIX = "music:";

export function renderPlanMusicRef(stockId: string): string {
  return `${RENDER_PLAN_MUSIC_PREFIX}${stockId}`;
}

/** Stock id inside a `music:` ref, or undefined for a renderer-local ref. */
export function renderPlanMusicId(ref: string): string | undefined {
  if (!ref.startsWith(RENDER_PLAN_MUSIC_PREFIX)) return undefined;
  const id = ref.slice(RENDER_PLAN_MUSIC_PREFIX.length);
  return id || undefined;
}

export type RenderPlanMediaKind = "still" | "video" | "none";

/** What the renderer must feed a scene. Dimensions drive the pan axis. */
export interface RenderPlanMedia {
  /** Opaque local reference. Empty only for the gray placeholder scene. */
  ref: string;
  kind: RenderPlanMediaKind;
  width: number;
  height: number;
  has_audio: boolean;
}

export interface RenderPlanCrop {
  focal_x: number;
  focal_y: number;
}

export type RenderPlanMotionType = "none" | "zoom" | "push";

/**
 * One scene's eased travel. A `zoom` whose `zoom_start` is above `zoom_end` is
 * a pull out, so the photo reel's alternating presets stay one motion type.
 */
export interface RenderPlanMotion {
  type: RenderPlanMotionType;
  zoom_start: number;
  zoom_end: number;
  pan_scale: number;
  /** Push travel direction: wide sources pan across, tall sources pan down. */
  axis: "x" | "y";
  easing: "cosine";
  /** Source overscan before the motion, so zoompan never samples a tiny crop. */
  sample_scale: number;
}

export interface RenderPlanWord {
  text: string;
  start_ms: number;
  end_ms: number;
}

/**
 * Burned overlay copy. `title` is already resolved (a title look without a
 * title borrows the caption, and then carries no caption words).
 */
export interface RenderPlanOverlay {
  look: OverlayLook;
  place: OverlayPlace;
  title: string | null;
  words: RenderPlanWord[];
  font_title: string;
  font_caption: string;
}

export interface RenderPlanScene {
  id: string;
  duration_ms: number;
  media: RenderPlanMedia;
  crop: RenderPlanCrop;
  motion: RenderPlanMotion;
  overlay: RenderPlanOverlay | null;
  fit: "cover" | "contain";
  audio_level: number;
}

export interface RenderPlanAudioTrack {
  ref: string;
  level: number;
  offset_ms: number;
}

export interface RenderPlanBed extends RenderPlanAudioTrack {
  /** Licensed beds repeat under the reel, so the renderer loops the source. */
  loop: true;
}

export interface RenderPlanAudio {
  bed: RenderPlanBed | null;
  voice: RenderPlanAudioTrack | null;
  /** Bed gain while a voice track is attached. */
  duck: number;
}

export interface RenderPlanBrandMark {
  ref: string;
  width: number;
  x: number;
  y: number;
  opacity: number;
}

export interface RenderPlanEncode {
  video: "h264";
  video_bitrate: string;
  pixel_format: "yuv420p";
  audio: "aac";
  audio_rate: number;
  audio_channels: number;
}

export interface RenderPlanV1 {
  schema: typeof RENDER_PLAN_SCHEMA;
  version: typeof RENDER_PLAN_VERSION;
  width: number;
  height: number;
  fps: number;
  scenes: RenderPlanScene[];
  audio: RenderPlanAudio;
  brand_mark: RenderPlanBrandMark | null;
  watermark: string | null;
  encode: RenderPlanEncode;
}

export class RenderPlanError extends Error {
  constructor(message: string) {
    super(`invalid render plan: ${message}`);
    this.name = "RenderPlanError";
  }
}

function fail(detail: string): never {
  throw new RenderPlanError(detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberField(source: Record<string, unknown>, key: string, path: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path}.${key} must be a number`);
  return value;
}

function stringField(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string") fail(`${path}.${key} must be a string`);
  return value;
}

function booleanField(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") fail(`${path}.${key} must be a boolean`);
  return value;
}

function recordField(source: Record<string, unknown>, key: string, path: string): Record<string, unknown> {
  const value = source[key];
  if (!isRecord(value)) fail(`${path}.${key} must be an object`);
  return value;
}

function nullableRecordField(
  source: Record<string, unknown>,
  key: string,
  path: string
): Record<string, unknown> | null {
  const value = source[key];
  if (value === null) return null;
  if (!isRecord(value)) fail(`${path}.${key} must be an object or null`);
  return value;
}

function enumField<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[]
): T {
  const value = source[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${path}.${key} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function positive(value: number, path: string): number {
  if (!(value > 0)) fail(`${path} must be greater than zero`);
  return value;
}

function unit(value: number, path: string): number {
  if (value < 0 || value > 1) fail(`${path} must stay between 0 and 1`);
  return value;
}

function media(value: Record<string, unknown>, path: string): RenderPlanMedia {
  return {
    ref: stringField(value, "ref", path),
    kind: enumField(value, "kind", path, ["still", "video", "none"] as const),
    width: numberField(value, "width", path),
    height: numberField(value, "height", path),
    has_audio: booleanField(value, "has_audio", path)
  };
}

function overlay(value: Record<string, unknown>, path: string): RenderPlanOverlay {
  const words = value.words;
  if (!Array.isArray(words)) fail(`${path}.words must be an array`);
  return {
    look: enumField(value, "look", path, overlayLooks),
    place: enumField(value, "place", path, overlayPlaces),
    title: value.title === null ? null : stringField(value, "title", path),
    words: words.map((word, index) => {
      const at = `${path}.words[${index}]`;
      if (!isRecord(word)) fail(`${at} must be an object`);
      return {
        text: stringField(word, "text", at),
        start_ms: numberField(word, "start_ms", at),
        end_ms: numberField(word, "end_ms", at)
      };
    }),
    font_title: stringField(value, "font_title", path),
    font_caption: stringField(value, "font_caption", path)
  };
}

function scene(value: unknown, path: string): RenderPlanScene {
  if (!isRecord(value)) fail(`${path} must be an object`);
  const motion = recordField(value, "motion", path);
  const motionPath = `${path}.motion`;
  const crop = recordField(value, "crop", path);
  const cropPath = `${path}.crop`;
  const overlayValue = nullableRecordField(value, "overlay", path);
  return {
    id: stringField(value, "id", path),
    duration_ms: positive(numberField(value, "duration_ms", path), `${path}.duration_ms`),
    media: media(recordField(value, "media", path), `${path}.media`),
    crop: {
      focal_x: unit(numberField(crop, "focal_x", cropPath), `${cropPath}.focal_x`),
      focal_y: unit(numberField(crop, "focal_y", cropPath), `${cropPath}.focal_y`)
    },
    motion: {
      type: enumField(motion, "type", motionPath, ["none", "zoom", "push"] as const),
      zoom_start: positive(numberField(motion, "zoom_start", motionPath), `${motionPath}.zoom_start`),
      zoom_end: positive(numberField(motion, "zoom_end", motionPath), `${motionPath}.zoom_end`),
      pan_scale: positive(numberField(motion, "pan_scale", motionPath), `${motionPath}.pan_scale`),
      axis: enumField(motion, "axis", motionPath, ["x", "y"] as const),
      easing: enumField(motion, "easing", motionPath, ["cosine"] as const),
      sample_scale: positive(numberField(motion, "sample_scale", motionPath), `${motionPath}.sample_scale`)
    },
    overlay: overlayValue ? overlay(overlayValue, `${path}.overlay`) : null,
    fit: enumField(value, "fit", path, ["cover", "contain"] as const),
    audio_level: unit(numberField(value, "audio_level", path), `${path}.audio_level`)
  };
}

function track(value: Record<string, unknown>, path: string): RenderPlanAudioTrack {
  return {
    ref: stringField(value, "ref", path),
    level: unit(numberField(value, "level", path), `${path}.level`),
    offset_ms: numberField(value, "offset_ms", path)
  };
}

function bed(value: Record<string, unknown>, path: string): RenderPlanBed {
  if (value.loop !== true) fail(`${path}.loop must be true`);
  return { ...track(value, path), loop: true };
}

function audio(value: Record<string, unknown>): RenderPlanAudio {
  const audioBed = nullableRecordField(value, "bed", "audio");
  const voice = nullableRecordField(value, "voice", "audio");
  return {
    bed: audioBed ? bed(audioBed, "audio.bed") : null,
    voice: voice ? track(voice, "audio.voice") : null,
    duck: unit(numberField(value, "duck", "audio"), "audio.duck")
  };
}

function brandMark(value: Record<string, unknown>): RenderPlanBrandMark {
  const path = "brand_mark";
  return {
    ref: stringField(value, "ref", path),
    width: positive(numberField(value, "width", path), `${path}.width`),
    x: numberField(value, "x", path),
    y: numberField(value, "y", path),
    opacity: unit(numberField(value, "opacity", path), `${path}.opacity`)
  };
}

function encode(value: Record<string, unknown>): RenderPlanEncode {
  const path = "encode";
  return {
    video: enumField(value, "video", path, ["h264"] as const),
    video_bitrate: stringField(value, "video_bitrate", path),
    pixel_format: enumField(value, "pixel_format", path, ["yuv420p"] as const),
    audio: enumField(value, "audio", path, ["aac"] as const),
    audio_rate: positive(numberField(value, "audio_rate", path), `${path}.audio_rate`),
    audio_channels: positive(numberField(value, "audio_channels", path), `${path}.audio_channels`)
  };
}

/**
 * Read a plan off the wire. Unknown fields are ignored so a v1 plan written
 * before an additive field still renders, but every field a renderer acts on
 * is checked, including the version: a v2 plan must be refused, not guessed.
 */
export function validateRenderPlanV1(value: unknown): RenderPlanV1 {
  if (!isRecord(value)) fail("plan must be an object");
  if (value.schema !== RENDER_PLAN_SCHEMA) fail(`schema must be ${RENDER_PLAN_SCHEMA}`);
  if (value.version !== RENDER_PLAN_VERSION) fail(`unsupported version ${String(value.version)}`);
  const scenes = value.scenes;
  if (!Array.isArray(scenes) || !scenes.length) fail("scenes must be a non-empty array");
  const brandMarkValue = nullableRecordField(value, "brand_mark", "plan");
  return {
    schema: RENDER_PLAN_SCHEMA,
    version: RENDER_PLAN_VERSION,
    width: positive(numberField(value, "width", "plan"), "width"),
    height: positive(numberField(value, "height", "plan"), "height"),
    fps: positive(numberField(value, "fps", "plan"), "fps"),
    scenes: scenes.map((item, index) => scene(item, `scenes[${index}]`)),
    audio: audio(recordField(value, "audio", "plan")),
    brand_mark: brandMarkValue ? brandMark(brandMarkValue) : null,
    watermark: value.watermark === null ? null : stringField(value, "watermark", "plan"),
    encode: encode(recordField(value, "encode", "plan"))
  };
}

export function isRenderPlanV1(value: unknown): value is RenderPlanV1 {
  try {
    validateRenderPlanV1(value);
    return true;
  } catch {
    return false;
  }
}

