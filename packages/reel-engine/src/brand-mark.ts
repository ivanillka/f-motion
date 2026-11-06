import type { BrandMarkSize } from "@f-engine/contracts";

/**
 * Corner lockup geometry, shared by the worker filter and the studio preview so
 * one set of fractions drives both. Compact draws the same 960x200 asset at a
 * fifth of the frame, quiet enough to read as a corner credit; standard is the
 * old 42% card.
 */
export interface BrandMarkLayout {
  /** Lockup width as a fraction of the frame width. */
  width: number;
  /** Inset from the right edge, as a fraction of the frame width. */
  right: number;
  /** Inset from the top edge, as a fraction of the frame height. */
  top: number;
  /** Alpha over the picture, so the mark sits under the copy. */
  opacity: number;
}

/**
 * Half opacity keeps the mark readable in a corner without competing with the
 * title. One number for both sizes: a small mark at full strength still shouts.
 */
export const BRAND_MARK_OPACITY = 0.45;

export const brandMarkLayouts: Record<BrandMarkSize, BrandMarkLayout> = {
  compact: { width: 0.2, right: 0.04, top: 0.035, opacity: BRAND_MARK_OPACITY },
  standard: { width: 0.42, right: 0.06, top: 0.05, opacity: BRAND_MARK_OPACITY }
};

/**
 * Absent size is compact, so an old reel picking up the mark stays quiet.
 * Compact at 1080 wide draws 216px in the top right, ending 5.8% down the
 * frame: above the 6% overlay safe inset and the top caption band.
 */
export function brandMarkLayout(size: BrandMarkSize | undefined): BrandMarkLayout {
  return size === "standard" ? brandMarkLayouts.standard : brandMarkLayouts.compact;
}

