import type { MotionStrength } from "@f-engine/contracts";

/**
 * Eased travel for one reel motion preset. Zoom moves the frame from
 * `zoomStart` to `zoomEnd`. Push holds `panScale` and travels the whole
 * overscan, so 1.06 leaves 6% of travel and 1.25 leaves 25%.
 *
 * Gentle ends 3% in on each side, so a picture keeps a 6% margin for any text
 * printed into it. Strong is the old 1.30 Ken Burns for reels that ask for it.
 */
export interface MotionTuning {
  zoomStart: number;
  zoomEnd: number;
  panScale: number;
}

export const MOTION_PRESETS: Record<MotionStrength, MotionTuning> = {
  gentle: { zoomStart: 1, zoomEnd: 1.06, panScale: 1.06 },
  strong: { zoomStart: 1, zoomEnd: 1.3, panScale: 1.25 }
};

/**
 * Absent strength is gentle. A reel recorded before the field existed never
 * chose a preset, so it calms down instead of cropping its own headlines.
 */
export function motionTuning(strength: MotionStrength | undefined): MotionTuning {
  return strength === "strong" ? MOTION_PRESETS.strong : MOTION_PRESETS.gentle;
}

/** Zoom in and zoom out share the same range, one forward and one back. */
export function motionZoomRange(tuning: MotionTuning): number {
  return tuning.zoomEnd - tuning.zoomStart;
}
