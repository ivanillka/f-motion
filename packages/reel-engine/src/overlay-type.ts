/**
 * One typography contract for the text burned over a scene. The worker's ASS
 * builder and the studio preview both read this module, so a look cannot have
 * one size, face, and safe width in the preview and another in the export.
 *
 * The unit is the ASS PlayRes: a size of 26 is 26/720 of a portrait frame's
 * width. The studio turns the same fractions into `cqw` values, which is why a
 * stage of any width prints the type at the ratio the export uses.
 *
 * The pill is square in both runtimes. libass BorderStyle 3 draws a box with no
 * corner radius, so the studio no longer rounds it; an ASS file has no way to
 * ask for a rounded pill.
 */

export type OverlayLook = "caption" | "title" | "poster" | "spoken";
export type OverlayPlace = "top" | "center" | "bottom";
/** The two lines a look can print: the headline and the caption under it. */
export type OverlayRole = "title" | "caption";

/** Clear space on each side of the frame, as a fraction of its width. */
export const OVERLAY_SAFE_INSET = 0.06;
/** Portrait reels print on this PlayRes; a landscape frame uses its own width. */
export const OVERLAY_PLAYRES_WIDTH = 720;
export const OVERLAY_PLAYRES_HEIGHT = 1280;
/** Spoken lines sit inside 80 PlayRes units a side, wider than the 6% inset. */
export const SPOKEN_SIDE_MARGIN = 80;
/** The ASS style's default bottom margin, in PlayRes units. */
export const OVERLAY_DEFAULT_MARGIN_V = 140;

export const OVERLAY_WHITE = "&H00FFFFFF";
export const OVERLAY_BLACK = "&H00000000";
/** Spoken words already read stay at half alpha, the same split the studio paints. */
export const OVERLAY_SPOKEN_SECONDARY = "&H80FFFFFF";
/** Caption pill black at 62% opacity. */
export const OVERLAY_PILL_ALPHA = 0.62;
/** ASS alpha is inverted: 62% opaque is 0x61. */
const assAlpha = (opacity: number): string =>
  Math.round(255 * (1 - opacity)).toString(16).toUpperCase().padStart(2, "0");
export const OVERLAY_PILL_BACK = `&H${assAlpha(OVERLAY_PILL_ALPHA)}000000`;

/** Gap between a stacked headline and caption, in em of the caption size. */
export const OVERLAY_STACK_GAP = 0.5;

/**
 * One face of a look. `spacing` and `tracking` are the same letter spacing in
 * the two systems: PlayRes units and em. ASS cannot set a line height, so
 * `lineHeight` is the studio's leading for the face.
 */
export interface OverlayFace {
  /** Fontname the worker hands libass. */
  assFont: string;
  /** Family the studio paints with; the studio loads the same Inter files. */
  cssFamily: string;
  weight: number;
  /** Size in PlayRes units. */
  size: number;
  /** ASS Spacing, in PlayRes units. */
  spacing: number;
  /** CSS letter-spacing, in em. */
  tracking: number;
  /** CSS line-height; libass uses the font's own line box. */
  lineHeight: number;
  uppercase: boolean;
  /** 1 is outlined text, 3 is the opaque box libass draws around the words. */
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  /** ASS BackColour: the shadow colour, or the pill when BorderStyle is 3. */
  back: string;
  secondary: string;
  /** True when the face draws the caption pill. */
  pill: boolean;
}

export interface OverlayLookType {
  title: OverlayFace;
  caption: OverlayFace;
}

function face(
  overrides: Pick<OverlayFace, "assFont" | "cssFamily" | "weight" | "size"> & Partial<OverlayFace>
): OverlayFace {
  return {
    spacing: 0,
    tracking: 0,
    lineHeight: 1.25,
    uppercase: false,
    borderStyle: 1,
    outline: 0,
    shadow: 1,
    back: OVERLAY_BLACK,
    secondary: "&H00AAAAAA",
    pill: false,
    ...overrides
  };
}

const HEADLINE = { assFont: "Inter Display ExtraBold", cssFamily: "Inter", weight: 800 } as const;
const CAPTION = { assFont: "Inter SemiBold", cssFamily: "Inter", weight: 600 } as const;
/** The pill the caption look and the title look's caption share. */
const CAPTION_PILL = face({
  ...CAPTION,
  size: 26,
  tracking: 0.01,
  borderStyle: 3,
  outline: 8,
  shadow: 0,
  back: OVERLAY_PILL_BACK,
  pill: true
});

/**
 * The faces of each look. Sizes and spacing are the ones the worker's ASS
 * styles have always printed; the studio reads the same numbers instead of
 * keeping its own copy in CSS.
 */
export const overlayType: Record<OverlayLook, OverlayLookType> = {
  caption: {
    title: face({
      ...HEADLINE,
      size: 64,
      spacing: -2,
      tracking: -0.03,
      lineHeight: 0.95,
      outline: 2,
      shadow: 3
    }),
    caption: CAPTION_PILL
  },
  title: {
    title: face({
      ...HEADLINE,
      size: 78,
      spacing: -3,
      tracking: -0.04,
      lineHeight: 0.95,
      uppercase: true,
      outline: 3,
      shadow: 2
    }),
    // Only the headline uppercases; a caption under it keeps the pill's case.
    caption: CAPTION_PILL
  },
  poster: {
    title: face({
      ...HEADLINE,
      size: 52,
      spacing: -2,
      tracking: -0.03,
      lineHeight: 0.95,
      outline: 2,
      shadow: 2
    }),
    // The poster caption sits on the fade band and has always printed without
    // an outline; the studio shadows it instead.
    caption: face({ ...CAPTION, size: 26, tracking: 0.01, outline: 0 })
  },
  spoken: {
    title: face({
      ...HEADLINE,
      size: 68,
      spacing: -1,
      tracking: -0.03,
      lineHeight: 1.05,
      outline: 3,
      shadow: 2
    }),
    // Spoken words print in the headline face; read words fade to half alpha.
    caption: face({
      ...HEADLINE,
      size: 68,
      spacing: -1,
      tracking: -0.03,
      lineHeight: 1.05,
      outline: 3,
      shadow: 2,
      secondary: OVERLAY_SPOKEN_SECONDARY
    })
  }
};

/** Padding libass draws around a pill caption, in em of the caption size. */
export function overlayPillPad(look: OverlayLook): number {
  const caption = overlayType[look].caption;
  return caption.pill ? caption.outline / caption.size : 0;
}

/** The margin a look keeps from the frame edge, in PlayRes units. */
export function overlaySideMargin(
  playResWidth = OVERLAY_PLAYRES_WIDTH,
  look: OverlayLook = "caption"
): number {
  return Math.max(
    Math.ceil(playResWidth * OVERLAY_SAFE_INSET),
    look === "spoken" ? SPOKEN_SIDE_MARGIN : 0
  );
}

/** Text width between those margins, in PlayRes units. */
export function overlaySafeWidth(
  playResWidth = OVERLAY_PLAYRES_WIDTH,
  look: OverlayLook = "caption"
): number {
  return playResWidth - 2 * overlaySideMargin(playResWidth, look);
}

/** ASS alignment number for a look and place. */
export function overlayAlign(look: OverlayLook, place: OverlayPlace | undefined): number {
  if (look === "spoken") return 5;
  if (look === "poster") return place === "top" ? 7 : place === "center" ? 4 : 1;
  return place === "bottom" ? 2 : 8;
}

/** The dialogue box the worker writes: margins are in PlayRes units. */
export interface OverlayPlacement {
  align: number;
  marginL: number;
  marginR: number;
  marginV: number;
  titleV: number;
  captionV: number;
}

/**
 * Where each dialogue sits. A zero vertical margin falls back to the style's
 * own, which is how the exporter has always stacked a title above a bottom
 * caption. The studio reads the same numbers as PlayRes fractions.
 */
export function overlayPlacement(
  look: OverlayLook,
  place: OverlayPlace | undefined,
  hasTitle: boolean,
  hasCaption: boolean
): OverlayPlacement {
  const align = overlayAlign(look, place);
  if (look === "spoken") {
    return { align, marginL: SPOKEN_SIDE_MARGIN, marginR: SPOKEN_SIDE_MARGIN, marginV: 0, titleV: 0, captionV: 0 };
  }
  if (look === "poster") {
    if (place === "top") return { align, marginL: 0, marginR: 0, marginV: 0, titleV: 36, captionV: hasTitle ? 110 : 36 };
    if (place === "center") return { align, marginL: 0, marginR: 0, marginV: 0, titleV: hasCaption ? 24 : 0, captionV: hasTitle ? 24 : 0 };
    return { align, marginL: 0, marginR: 0, marginV: 0, titleV: hasCaption ? 96 : 36, captionV: 36 };
  }
  if (place === "top") return { align, marginL: 0, marginR: 0, marginV: 0, titleV: 88, captionV: hasTitle ? 176 : 88 };
  if (place === "center") return { align, marginL: 0, marginR: 0, marginV: 0, titleV: hasCaption ? 500 : 560, captionV: hasTitle ? 590 : 560 };
  return { align, marginL: 0, marginR: 0, marginV: 0, titleV: hasCaption ? 228 : 0, captionV: 0 };
}

/** The margins the ASS styles carry; a dialogue's own margin overrides them. */
export function overlayStyleBox(
  look: OverlayLook,
  playResWidth = OVERLAY_PLAYRES_WIDTH
): { align: number; marginL: number; marginR: number; marginV: number } {
  if (look === "spoken") {
    return { align: 5, marginL: SPOKEN_SIDE_MARGIN, marginR: SPOKEN_SIDE_MARGIN, marginV: 0 };
  }
  const side = overlaySideMargin(playResWidth, look);
  return { align: 2, marginL: side, marginR: side, marginV: OVERLAY_DEFAULT_MARGIN_V };
}

/**
 * ASS WrapStyle 0 wraps on spaces only, so one long word walks straight past
 * the safe zone. A line whose longest word does not fit takes a font-size
 * override; a word that stays too wide even shrunk is hard-broken instead.
 * ponytail: the advance is a deliberate overestimate for Inter Display
 * ExtraBold uppercase, so the rendered bounds test is the real check.
 */
export const OVERLAY_GLYPH_ADVANCE = 0.75;
export const OVERLAY_MIN_SCALE = 0.55;

export interface OverlayTextFit {
  /** Font size override for the line, when the style size is too wide. */
  fontSize?: number;
  /** Characters per line for a word too wide even at the smallest size. */
  chunk?: number;
}

export function fitOverlayText(words: string[], size: number, safeWidth: number): OverlayTextFit {
  const longest = words.reduce((max, word) => Math.max(max, word.trim().length), 0);
  if (longest === 0) return {};
  const expected = (chars: number, at: number) => chars * at * OVERLAY_GLYPH_ADVANCE;
  if (expected(longest, size) <= safeWidth) return {};
  const scale = safeWidth / expected(longest, size);
  if (scale >= OVERLAY_MIN_SCALE) return { fontSize: Math.max(16, Math.floor(size * scale)) };
  return { chunk: Math.max(1, Math.floor(safeWidth / (size * OVERLAY_GLYPH_ADVANCE))) };
}

/** The fit for one look's line, measured against the same safe width the ASS style uses. */
export function overlayFit(
  look: OverlayLook,
  role: OverlayRole,
  words: string[],
  playResWidth = OVERLAY_PLAYRES_WIDTH
): OverlayTextFit {
  return fitOverlayText(words, overlayType[look][role].size, overlaySafeWidth(playResWidth, look));
}

/** Split one word into chunks that fit; a word inside the chunk is returned whole. */
export function chunkOverlayWord(word: string, chunk: number): string[] {
  if (chunk < 1 || word.length <= chunk) return [word];
  const pieces: string[] = [];
  for (let index = 0; index < word.length; index += chunk) {
    pieces.push(word.slice(index, index + chunk));
  }
  return pieces;
}
