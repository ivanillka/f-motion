import { seekSceneVisual, type SeekVisual } from "@f-engine/reel-engine";

/**
 * The scene fields the live stage reads. It mirrors the export's scene so the
 * shared seek helper can be called with the studio's own snapshot.
 */
export interface LivePreviewScene {
  id: string;
  order: number;
  caption: string;
  duration_ms: number;
  focal_x: number;
  focal_y: number;
  motion: "none" | "push" | "zoom" | "zoom_out";
  audio_level: number;
  ducking: boolean;
  title?: string;
  overlay_place?: "bottom" | "center" | "top";
  overlay_look?: "caption" | "title" | "poster" | "spoken";
  fit?: "cover" | "contain";
}

/** The brief fields that decide motion, mark size, and the moved frame. */
export interface LivePreviewBrief {
  motion_strength?: "gentle" | "strong";
  brand_mark_size?: "compact" | "standard";
}

/**
 * One moment of the preview: the export's geometry plus the CSS transform the
 * stage applies. `offset` is the pan in the worker's zoompan terms, which is
 * what the browser and the FFmpeg filter can be compared on.
 */
export interface LivePreviewFrame extends SeekVisual {
  transform: string;
  offset: { x: number; y: number };
}

/**
 * Seek the live stage without playing it. Everything the stage draws comes from
 * this one call, so a scrub, a paused frame, and a playing frame all match the
 * export at the same elapsed time.
 */
export function livePreviewFrame(
  scene: LivePreviewScene,
  elapsedMs: number,
  brief: LivePreviewBrief = {},
  frame: { width: number; height: number } = { width: 1080, height: 1920 },
  source?: { width: number; height: number }
): LivePreviewFrame {
  const visual = seekSceneVisual(scene, elapsedMs, brief, frame, source);
  const across = Number((visual.translate.x * 100).toFixed(4));
  const down = Number((visual.translate.y * 100).toFixed(4));
  return {
    ...visual,
    transform: `translate3d(${across}%, ${down}%, 0) scale(${visual.zoom.toFixed(6)})`,
    offset: { x: visual.pan.x, y: visual.pan.y }
  };
}
