/** Always-visible Create chrome source chips. Extensible without redesign. */

export type SourceId = "own" | "pexels" | "fal" | "more";

export type SourceState = "ready" | "connected" | "locked" | "unavailable" | "coming";

export interface SourceChip {
  id: SourceId;
  label: string;
  detail: string;
  state: SourceState;
}

export interface MediaSourcesInput {
  ownCount: number;
  pexelsConnected: boolean;
  pexelsUnavailable?: boolean;
  falConnected: boolean;
  falUnavailable?: boolean;
}

export function mediaSourceChips(input: MediaSourcesInput): SourceChip[] {
  const ownReady = input.ownCount > 0;
  const pexelsState: SourceState = input.pexelsUnavailable
    ? "unavailable"
    : input.pexelsConnected
      ? "connected"
      : "locked";
  const falState: SourceState = input.falUnavailable
    ? "unavailable"
    : input.falConnected
      ? "connected"
      : "locked";
  return [
    {
      id: "own",
      label: "Own",
      detail: ownReady
        ? `${input.ownCount} in pool`
        : "Drop or add later",
      state: ownReady ? "ready" : "locked"
    },
    {
      id: "pexels",
      label: "Pexels",
      detail: pexelsState === "connected"
        ? "BYOK connected"
        : pexelsState === "unavailable"
          ? "Unavailable here"
          : "BYOK needed",
      state: pexelsState
    },
    {
      id: "fal",
      label: "FAL",
      detail: falState === "connected"
        ? "BYOK connected"
        : falState === "unavailable"
          ? "Unavailable here"
          : "BYOK needed",
      state: falState
    },
    {
      id: "more",
      label: "More",
      detail: "New options",
      state: "coming"
    }
  ];
}

export function sourceChipTone(state: SourceState): "on" | "warn" | "muted" {
  if (state === "ready" || state === "connected") return "on";
  if (state === "unavailable") return "warn";
  return "muted";
}

/** Reel setting: animate pool stills via FAL image-to-video (BYOK). */
export function animateStillsToggleState(input: {
  falConnected: boolean;
  falUnavailable: boolean;
  stillCount: number;
}): { enabled: boolean; reason: string } {
  if (input.falUnavailable) {
    return { enabled: false, reason: "FAL unavailable here" };
  }
  if (!input.falConnected) {
    return { enabled: false, reason: "Connect FAL (BYOK)" };
  }
  if (input.stillCount <= 0) {
    return { enabled: false, reason: "Needs stills in pool" };
  }
  return { enabled: true, reason: "Off by default · quote→confirm each" };
}

export function countStillFiles(files: ReadonlyArray<{ type: string }>): number {
  return files.filter((file) => file.type.startsWith("image/")).length;
}

export function isReadyStillMedia(media: {
  state?: string;
  detected?: { type?: string };
} | undefined): boolean {
  if (!media || media.state !== "ready") return false;
  const type = media.detected?.type ?? "";
  if (!type || type.startsWith("video/")) return false;
  return true;
}
