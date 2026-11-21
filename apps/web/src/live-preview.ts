import {
  OVERLAY_DEFAULT_MARGIN_V,
  OVERLAY_PILL_ALPHA,
  overlayPillPad,
  overlayPlacement,
  overlayType,
  seekSceneVisual,
  type OverlayFace,
  type SeekOverlayLayout,
  type SeekVisual
} from "@f-engine/reel-engine";

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
  /** Measured take timing, so the lit word follows the exported cue window. */
  caption_cues?: { text: string; start_ms: number; end_ms: number }[];
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

/** PlayRes numbers print with four decimals, the precision the seek reports. */
const decimals = 4;
/** A percentage of the frame, the unit the inset and the safe width use. */
const fraction = (value: number): string => `${Number((value * 100).toFixed(decimals))}`;
/** A size as a bare fraction of the frame's width, which the stylesheet scales. */
const scale = (value: number): string => `${Number(value.toFixed(decimals))}`;

/**
 * One face as CSS custom properties. The export hands libass a font name, a
 * weight, and a spacing in PlayRes units; the stage gets the same face with the
 * spacing in em and the leading the face declares, because ASS has no line box.
 */
function faceVars(role: "title" | "caption", face: OverlayFace): Record<string, string> {
  return {
    [`--type-${role}-family`]: `${face.cssFamily}, ui-sans-serif, system-ui, sans-serif`,
    [`--type-${role}-weight`]: String(face.weight),
    [`--type-${role}-tracking`]: `${face.tracking}em`,
    [`--type-${role}-leading`]: String(face.lineHeight),
    [`--type-${role}-case`]: face.uppercase ? "uppercase" : "none"
  };
}

/** One line's vertical edge and centering transform, as CSS. */
function placeVars(
  role: "title" | "caption",
  edge: { top: string; bottom: string; transform?: string }
): Record<string, string> {
  return {
    [`--type-${role}-top`]: edge.top,
    [`--type-${role}-bottom`]: edge.bottom,
    [`--type-${role}-transform`]: edge.transform ?? "none"
  };
}

/**
 * The stage's overlay style, built from the same contract the export reads.
 * Every number is a PlayRes fraction turned into `cqw`, so the browser prints
 * the type at the ratio libass uses at any stage width, and the studio's
 * stylesheet holds paint only.
 *
 * `hasTitle` and `hasCaption` say which lines are on screen, because the export
 * only stacks the two apart when both exist.
 */
export function overlayStyle(
  layout: SeekOverlayLayout,
  hasTitle: boolean,
  hasCaption: boolean
): Record<string, string> {
  const type = overlayType[layout.look];
  const box = overlayPlacement(layout.look, layout.place, hasTitle, hasCaption);
  // 100cqw is the stage width, which is the PlayRes width in the export's terms.
  const cqw = (units: number): string => `${Number(((units / layout.playRes.width) * 100).toFixed(decimals))}cqw`;
  const anchored = layout.place !== "center"
    || (layout.look !== "poster" && layout.look !== "spoken");
  const edge = anchored
    ? layout.place === "bottom"
      ? { title: box.titleV || OVERLAY_DEFAULT_MARGIN_V, caption: box.captionV || OVERLAY_DEFAULT_MARGIN_V }
      : { title: box.titleV, caption: box.captionV }
    : undefined;
  // A centered block truly centers where libass aligns to the middle of the
  // frame; an anchored block keeps the dialogue's own margin.
  const centered = { top: "50%", bottom: "auto", transform: "translateY(-50%)" };
  const line = (units: number) =>
    layout.place === "bottom" ? { top: "auto", bottom: cqw(units) } : { top: cqw(units), bottom: "auto" };
  return {
    "--type-title": scale(layout.titleSize),
    "--type-caption": scale(layout.captionSize),
    "--type-safe-width": `${fraction(layout.safeWidth)}%`,
    "--type-inset": `${fraction(layout.safeInset)}%`,
    "--type-align": layout.look === "poster" ? "left" : "center",
    // libass BorderStyle 3 draws a square box, so the pill has no radius here.
    "--type-pill": type.caption.pill ? `rgba(0, 0, 0, ${OVERLAY_PILL_ALPHA})` : "none",
    "--type-pill-pad": String(Number(overlayPillPad(layout.look).toFixed(decimals))),
    ...faceVars("title", type.title),
    ...faceVars("caption", type.caption),
    ...placeVars("title", edge ? line(edge.title) : centered),
    ...placeVars("caption", edge ? line(edge.caption) : centered)
  };
}
