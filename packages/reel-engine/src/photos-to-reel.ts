import type { MotionPreset, Scene } from "@f-engine/contracts";

/**
 * Beat counts a photo reel shot owns, repeating through the storyboard. The
 * default asks for a 2 beat opener, a 3 beat beat, then an 8 beat look, so the
 * reel breathes instead of cutting on every beat.
 */
export const PHOTOS_TO_REEL_PATTERN: readonly number[] = [2, 3, 8];

/** Shot motions in order, repeating: zoom in, zoom out, pan. */
export const PHOTOS_TO_REEL_MOTIONS: readonly MotionPreset[] = ["zoom", "zoom_out", "push"];

/**
 * Longest photo reel the studio builds. A pattern of long looks at a slow tempo
 * runs past a comfortable reel long before it runs out of scenes, so the length
 * is its own plain limit rather than a second scene cap.
 */
export const PHOTOS_TO_REEL_MAX_MS = 90_000;

/**
 * Thrown when the picked shots add up to a reel longer than
 * PHOTOS_TO_REEL_MAX_MS. The studio turns this into plain advice instead of a
 * generic failure.
 */
export class PhotoReelTooLongError extends Error {
  readonly total_ms: number;
  readonly limit_ms: number;

  constructor(total_ms: number, limit_ms: number) {
    super(`photo reel runs ${Math.round(total_ms / 1000)} seconds, over the ${limit_ms / 1000} second limit`);
    this.name = "PhotoReelTooLongError";
    this.total_ms = total_ms;
    this.limit_ms = limit_ms;
  }
}

/** Plain default title for the first shot. */
export const PHOTOS_TO_REEL_TITLE = "My photos";

/** Whole beats a single shot may own, matching the 0.5 s to 15 s scene contract. */
const MAX_SHOT_BEATS = 48;
const MAX_PATTERN_LENGTH = 8;
const MAX_TITLE_LENGTH = 60;
const MAX_CAPTION_LENGTH = 180;
const MAX_VISUAL_PROMPT_LENGTH = 240;

/**
 * Beat pattern from studio input such as "2,3,8". Anything the reader cannot
 * use falls back to the default pattern, and every value stays a whole beat
 * count the scene contract can hold.
 */
export function parseBeatPattern(raw: unknown): number[] {
  const text = Array.isArray(raw) ? raw.join(",") : String(raw ?? "");
  const beats = text
    .split(/[^0-9]+/u)
    .map((part) => Number(part))
    .filter((beats) => Number.isInteger(beats) && beats >= 1)
    .map((beats) => Math.min(MAX_SHOT_BEATS, beats))
    .slice(0, MAX_PATTERN_LENGTH);
  return beats.length ? beats : [...PHOTOS_TO_REEL_PATTERN];
}

/** Ceilings a stored still must fit, mirroring the worker media limits shape. */
export interface PhotoFitLimits {
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
}

/**
 * Fitted still size for a photo that is over the media limits, or undefined
 * when it already fits. Aspect ratio is kept and both sides round down, so the
 * fitted photo can never land back over a limit.
 */
export function photoFitTarget(
  width: number,
  height: number,
  limits: PhotoFitLimits
): { width: number; height: number } | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  if (width <= limits.maxWidth && height <= limits.maxHeight && width * height <= limits.maxPixels) {
    return undefined;
  }
  const scale = Math.min(
    1,
    limits.maxWidth / width,
    limits.maxHeight / height,
    Math.sqrt(limits.maxPixels / (width * height))
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  };
}

export interface PhotosToReelShot {
  index: number;
  role: "photo" | "end_card";
  /** Whole beats this shot owns after the grid clamps it to the scene contract. */
  beats: number;
  start_frame: number;
  /** Absolute cut, rounded to a frame from the cumulative beat grid. */
  end_frame: number;
  /** Difference from the previous cut, so frame rounding never accumulates. */
  duration_ms: number;
  motion: MotionPreset;
}

export interface PhotosToReelPlan {
  bpm: number;
  pattern: number[];
  title: string;
  end_card: string;
  shots: PhotosToReelShot[];
  total_frames: number;
  total_ms: number;
}

export interface PhotosToReelSceneOptions {
  /** One scene id per shot, index aligned with the plan. */
  ids: readonly string[];
  /** Viewer-facing caption per shot. Absent means an empty caption. */
  captions?: readonly string[];
  /** Search and generation intent per shot. */
  visualPrompts?: readonly string[];
}

/** Collapsed, trimmed and capped plain text for a scene field. */
export function photoReelText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

/** Photo shots in order, then the end card. Beat counts repeat the pattern. */
export function photosToReelShotBeats(photoCount: number, pattern: readonly number[] = PHOTOS_TO_REEL_PATTERN): number[] {
  const shots = Math.max(0, Math.trunc(photoCount)) + 1;
  const beats = pattern.length ? pattern : [...PHOTOS_TO_REEL_PATTERN];
  return Array.from({ length: shots }, (_, index) => beats[index % beats.length]!);
}

/**
 * Storyboard scenes for a photo reel: one scene per photo plus the end card
 * last. Durations come from the plan (already on the beat grid), shot one
 * carries the title overlay, and the end card keeps the reel CTA centred on the
 * brand mark the worker already draws.
 */
export function photosToReelScenes(plan: PhotosToReelPlan, options: PhotosToReelSceneOptions): Scene[] {
  if (options.ids.length !== plan.shots.length) throw new Error("photo reel needs one scene id per shot");
  const title = photoReelText(plan.title, MAX_TITLE_LENGTH);
  const endCard = photoReelText(plan.end_card, MAX_CAPTION_LENGTH);
  return plan.shots.map((shot, index) => {
    const caption = shot.role === "end_card"
      ? endCard
      : photoReelText(options.captions?.[index], MAX_CAPTION_LENGTH);
    const visualPrompt = photoReelText(
      options.visualPrompts?.[index],
      MAX_VISUAL_PROMPT_LENGTH
    ) || (shot.role === "end_card" ? endCard : title) || `Photo ${index + 1}`;
    const overlay = shot.role === "end_card"
      ? { overlay_look: "spoken" as const, overlay_place: "center" as const }
      : index === 0 && title
        ? { title, overlay_look: "title" as const, overlay_place: "center" as const }
        : {};
    return {
      id: options.ids[index]!,
      order: index,
      caption,
      duration_ms: shot.duration_ms,
      focal_x: 0.5,
      focal_y: 0.5,
      motion: shot.motion,
      audio_level: 1,
      ducking: false,
      visual_prompt: visualPrompt,
      ...overlay
    };
  });
}
