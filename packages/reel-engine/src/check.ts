import type {
  CaptionCue,
  OverlayLook,
  ProjectSnapshot,
  Scene
} from "@f-engine/contracts";
import { brandMarkLayout } from "./brand-mark.js";
import {
  OVERLAY_DEFAULT_MARGIN_V,
  OVERLAY_GLYPH_ADVANCE,
  OVERLAY_PLAYRES_HEIGHT,
  OVERLAY_PLAYRES_WIDTH,
  fitOverlayText,
  overlayPlacement,
  overlaySafeWidth,
  overlaySideMargin,
  overlayType,
  type OverlayFace,
  type OverlayTextFit
} from "./overlay-type.js";
import { SPOKEN_TAKE_PAD_MS } from "./spoken-narration.js";
import { cuesForScene, spokenWordsForCues } from "./index.js";

/**
 * Pre-render check for one ProjectSnapshot. The checker reads the same
 * typography, brand mark, and spoken timing contract the worker renders with,
 * so a problem it reports is a problem the export would show. It never reads a
 * file, calls a provider, or changes the project: the API and the CLI add the
 * measured facts they already have.
 */
export const checkCodes = [
  "storyboard_empty",
  "media_missing",
  "media_not_ready",
  "caption_empty",
  "invalid_cues",
  "overlay_overflow",
  "brand_mark_overlap",
  "spoken_take_overrun",
  "spoken_cue_overrun"
] as const;

export type CheckCode = (typeof checkCodes)[number];

export interface CheckIssue {
  code: CheckCode;
  /** Present when the issue belongs to one scene. */
  scene_id?: string;
  /** One short sentence a person can act on. */
  message: string;
}

export interface CheckReport {
  errors: CheckIssue[];
  warnings: CheckIssue[];
}

/** Facts only the host can measure. Absent facts skip the matching checks. */
export interface CheckFacts {
  /** Media state per asset id, as the media repository reports it. */
  media?: Readonly<Record<string, { state: string }>>;
  /** Measured spoken take length per scene id, in milliseconds. */
  spoken_takes?: Readonly<Record<string, number>>;
}

/** The mark asset is 960x200, so the worker scales it to that ratio. */
const MARK_ASPECT = 200 / 960;

function issue(code: CheckCode, message: string, scene?: Scene): CheckIssue {
  return scene ? { code, scene_id: scene.id, message } : { code, message };
}

function lookOf(scene: Scene): OverlayLook {
  return scene.overlay_look ?? "caption";
}

/** Normalized caption text, the same trimming the spoken narration applies. */
function captionText(scene: Scene): string {
  return scene.caption.replace(/\s+/gu, " ").trim();
}

function titleText(scene: Scene, look: OverlayLook): string {
  if (look === "spoken") return "";
  return scene.title?.replace(/\s+/gu, " ").trim() ?? "";
}

interface OverlayMeasure {
  /** Text boxes the worker actually draws, in PlayRes units. */
  boxes: { x: number; y: number; width: number; height: number }[];
  overflow: boolean;
}

function textWidth(text: string, size: number, spacing: number): number {
  const chars = text.length;
  if (!chars) return 0;
  return chars * size * OVERLAY_GLYPH_ADVANCE + Math.max(0, chars - 1) * spacing;
}

/**
 * Widest rendered line for a paragraph libass wraps on spaces. A word wider
 * than the safe area is clamped, because the fit shrinks the face or breaks it.
 */
function wrappedWidth(text: string, size: number, spacing: number, safeWidth: number): number {
  const tokens = text.split(/\s+/u).filter(Boolean);
  if (!tokens.length) return 0;
  const space = size * OVERLAY_GLYPH_ADVANCE + spacing;
  let line = 0;
  let widest = 0;
  for (const token of tokens) {
    const word = Math.min(safeWidth, textWidth(token, size, spacing));
    if (line > 0 && line + space + word > safeWidth) {
      widest = Math.max(widest, line);
      line = word;
    } else {
      line = line > 0 ? line + space + word : word;
    }
  }
  return Math.min(safeWidth, Math.max(widest, line));
}

function lineCount(text: string, size: number, spacing: number, safeWidth: number): number {
  const tokens = text.split(/\s+/u).filter(Boolean);
  if (!tokens.length) return 0;
  const space = size * OVERLAY_GLYPH_ADVANCE + spacing;
  let line = 0;
  let lines = 1;
  for (const token of tokens) {
    const word = Math.min(safeWidth, textWidth(token, size, spacing));
    if (line > 0 && line + space + word > safeWidth) {
      lines += 1;
      line = word;
    } else {
      line = line > 0 ? line + space + word : word;
    }
  }
  return lines;
}

function textBox(
  text: string,
  face: OverlayFace,
  size: number,
  align: number,
  marginV: number,
  look: OverlayLook
): { x: number; y: number; width: number; height: number } | undefined {
  const side = overlaySideMargin(OVERLAY_PLAYRES_WIDTH, look);
  const safeWidth = overlaySafeWidth(OVERLAY_PLAYRES_WIDTH, look);
  const width = Math.min(safeWidth, wrappedWidth(text, size, face.spacing, safeWidth));
  if (width <= 0) return undefined;
  const lines = lineCount(text, size, face.spacing, safeWidth);
  const height = lines * size * face.lineHeight;
  const top = marginV > 0 ? marginV : OVERLAY_DEFAULT_MARGIN_V;
  const pad = face.outline;
  if (align === 8) {
    return {
      x: (OVERLAY_PLAYRES_WIDTH - width) / 2 - pad,
      y: top - pad,
      width: width + 2 * pad,
      height: height + 2 * pad
    };
  }
  if (align === 7) {
    return { x: side - pad, y: top - pad, width: width + 2 * pad, height: height + 2 * pad };
  }
  return undefined;
}

/**
 * Mirrors `buildCaptionAss` in the worker: which line is drawn, at which size,
 * after the fit shrinks a long word. Boxes are only needed where the text
 * could reach the top right corner.
 */
function measureOverlay(scene: Scene, look: OverlayLook): OverlayMeasure {
  const cues = cuesForScene(scene);
  const face = overlayType[look].title;
  const captionFace = overlayType[look].caption;
  let title = titleText(scene, look);
  let captionCues = cues;
  if (look === "title" && !title) {
    title = captionText(scene);
    captionCues = [];
  }
  if (face.uppercase && title) title = title.toUpperCase();
  const place = scene.overlay_place ?? (look === "title" ? "center" : "bottom");
  const layout = overlayPlacement(look, place, Boolean(title), captionCues.length > 0);
  const safeWidth = overlaySafeWidth(OVERLAY_PLAYRES_WIDTH, look);
  const words = spokenWordsForCues(captionCues);
  const titleFit: OverlayTextFit = title ? fitOverlayText([title], face.size, safeWidth) : {};
  const captionFit: OverlayTextFit = words.length
    ? fitOverlayText(words.map((word) => word.text), captionFace.size, safeWidth)
    : {};
  const boxes: OverlayMeasure["boxes"] = [];
  if (title && layout.align !== 5 && !titleFit.chunk) {
    const box = textBox(title, face, titleFit.fontSize ?? face.size, layout.align, layout.titleV, look);
    if (box) boxes.push(box);
  }
  if (words.length && layout.align !== 5 && !captionFit.chunk) {
    const box = textBox(
      words.map((word) => word.text).join(" "),
      captionFace,
      captionFit.fontSize ?? captionFace.size,
      layout.align,
      layout.captionV,
      look
    );
    if (box) boxes.push(box);
  }
  return { boxes, overflow: Boolean(titleFit.chunk || captionFit.chunk) };
}

function markBox(snapshot: ProjectSnapshot): { x: number; y: number; width: number; height: number } {
  const layout = brandMarkLayout(snapshot.brief.brand_mark_size);
  const width = Math.max(48, Math.round(OVERLAY_PLAYRES_WIDTH * layout.width));
  return {
    x: OVERLAY_PLAYRES_WIDTH - width - Math.round(OVERLAY_PLAYRES_WIDTH * layout.right),
    y: Math.round(OVERLAY_PLAYRES_HEIGHT * layout.top),
    width,
    height: Math.round(width * MARK_ASPECT)
  };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}



function checkMedia(scene: Scene, facts: CheckFacts, errors: CheckIssue[]): void {
  if (!scene.media_id) {
    errors.push(issue("media_missing", "This scene has no picture yet.", scene));
    return;
  }
  const state = facts.media?.[scene.media_id]?.state;
  if (state === "missing") {
    errors.push(issue("media_missing", "The picture attached to this scene is missing.", scene));
  } else if (state && state !== "ready") {
    errors.push(issue("media_not_ready", "The picture attached to this scene is not ready yet.", scene));
  }
}

function checkSpokenTiming(
  scene: Scene,
  cues: CaptionCue[],
  facts: CheckFacts,
  errors: CheckIssue[]
): void {
  const take = facts.spoken_takes?.[scene.id];
  if (!Number.isFinite(take) || (take ?? 0) <= 0) return;
  const measured = take as number;
  if (Math.ceil(measured) + SPOKEN_TAKE_PAD_MS > scene.duration_ms + 1) {
    errors.push(issue("spoken_take_overrun", "The recorded line is longer than this scene.", scene));
  }
  const lastCueEnd = cues[cues.length - 1]?.end_ms ?? 0;
  // The scene holds the last word for the breath after the take, so only a cue
  // past that window means a word stays lit in real silence.
  if (lastCueEnd > Math.round(measured) + SPOKEN_TAKE_PAD_MS + 1) {
    errors.push(issue("spoken_cue_overrun", "A word stays on screen after the recorded line ends.", scene));
  }
}

function checkScene(
  scene: Scene,
  snapshot: ProjectSnapshot,
  facts: CheckFacts,
  errors: CheckIssue[],
  warnings: CheckIssue[]
): void {
  const look = lookOf(scene);
  const caption = captionText(scene);
  const title = titleText(scene, look);

  checkMedia(scene, facts, errors);

  if (look === "spoken" && !caption) {
    errors.push(issue("caption_empty", "Add words so this voice line has something to say.", scene));
  }
  if (look === "title" && !title && !caption) {
    errors.push(issue("caption_empty", "Add a title or a caption to this scene.", scene));
  }

  let cues: CaptionCue[] = [];
  try {
    cues = cuesForScene(scene);
  } catch {
    errors.push(issue("invalid_cues", "The word timing in this scene does not fit its length.", scene));
    return;
  }

  if (look === "spoken") {
    checkSpokenTiming(scene, cues, facts, errors);
  }

  const overlay = measureOverlay(scene, look);
  if (overlay.overflow) {
    errors.push(issue("overlay_overflow", "A word is too long to fit the safe area at the smallest size.", scene));
  }

  if (snapshot.brief.brand_mark) {
    const mark = markBox(snapshot);
    if (overlay.boxes.some((box) => overlaps(box, mark))) {
      warnings.push(issue("brand_mark_overlap", "The F-Motion mark sits over the top text.", scene));
    }
  }
}

/**
 * Pure check of one storyboard against the reel standard. Deterministic: the
 * same snapshot and facts always return the same issues in scene order.
 */
export function checkProject(snapshot: ProjectSnapshot, facts: CheckFacts = {}): CheckReport {
  const errors: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  if (!snapshot.scenes.length) {
    errors.push(issue("storyboard_empty", "The storyboard has no scenes yet."));
    return { errors, warnings };
  }
  const scenes = [...snapshot.scenes].sort((left, right) => left.order - right.order);
  for (const scene of scenes) {
    checkScene(scene, snapshot, facts, errors, warnings);
  }
  return { errors, warnings };
}
