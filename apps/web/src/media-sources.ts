/** Always-visible Create chrome source chips. Extensible without redesign. */

export type SourceId = "own" | "pexels" | "civitai" | "fal" | "more";

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
  civitaiConnected: boolean;
  civitaiUnavailable?: boolean;
  civitaiKeyless?: boolean;
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
  const civitaiState: SourceState = input.civitaiConnected || input.civitaiKeyless
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
      label: "My photos",
      detail: ownReady
        ? `${input.ownCount} added`
        : "Add yours",
      state: ownReady ? "ready" : "locked"
    },
    {
      id: "pexels",
      label: "Pexels",
      detail: pexelsState === "connected"
        ? "Your key"
        : pexelsState === "unavailable"
          ? "Not available here"
          : "Add your key",
      state: pexelsState
    },
    ...(!input.civitaiUnavailable ? [{
      id: "civitai" as const,
      label: "Civitai",
      detail: civitaiState === "connected"
        ? input.civitaiConnected ? "Your key" : "Keyless"
        : "Add your key",
      state: civitaiState
    }] : []),
    {
      id: "fal",
      label: "FAL",
      detail: falState === "connected"
        ? "Your key"
        : falState === "unavailable"
          ? "Not available here"
          : "Add your key",
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

/** Where the Create chat's picture answer really points. */
export type VisualSourceId = "own" | "pexels" | "civitai" | "fal" | "mix";

export interface VisualSourceChoice {
  id: VisualSourceId;
  /** Chat answer label; also what the studio remembers for next time. */
  label: string;
  /** Short source name used inside mix labels and prompts. */
  name: string;
  /** Honest "where the pictures come from" phrase for ready lines. */
  where: string;
}

export interface VisualSourceOptions {
  choices: VisualSourceChoice[];
  /** Short names of connected external sources, in chip order. */
  connected: string[];
  /** One line about sources that cannot be used yet, or "" when all are usable. */
  hint: string;
}

/** Remembers the last picture source the owner chose in the Create chat. */
export const VISUAL_SOURCE_STORAGE_KEY = "fengine-visual-source";

const visualSourceIds: readonly VisualSourceId[] = ["own", "pexels", "civitai", "fal", "mix"];

export function readRememberedVisualSource(
  storage?: Pick<Storage, "getItem">
): VisualSourceId | undefined {
  try {
    const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    const value = store?.getItem(VISUAL_SOURCE_STORAGE_KEY) as VisualSourceId | null | undefined;
    return value && visualSourceIds.includes(value) ? value : undefined;
  } catch {
    // private mode blocks storage; the answer still works for this session
    return undefined;
  }
}

export function rememberVisualSource(
  id: VisualSourceId | undefined,
  storage?: Pick<Storage, "setItem" | "removeItem">
): void {
  try {
    const store = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    if (!store) return;
    if (id) store.setItem(VISUAL_SOURCE_STORAGE_KEY, id);
    else store.removeItem(VISUAL_SOURCE_STORAGE_KEY);
  } catch {
    // private mode blocks storage; the answer still works for this session
  }
}

function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Chat answers for "where do the pictures come from". Only sources that can
 * deliver right now are offered: own photos always, an external source only
 * when its chip is connected, plus one mix answer when both sides exist.
 * Locked or unavailable sources are named in a single hint line instead of
 * becoming choices, and the "More" slot is never offered as an answer.
 */
export function visualSourceOptions(
  input: MediaSourcesInput & { remembered?: VisualSourceId }
): VisualSourceOptions {
  const chips = mediaSourceChips(input);
  const state = (id: SourceId): SourceState | undefined =>
    chips.find((chip) => chip.id === id)?.state;
  const external: VisualSourceChoice[] = [];
  if (state("pexels") === "connected") {
    external.push({ id: "pexels", name: "Pexels", label: "Pexels videos", where: "Pexels videos" });
  }
  if (state("civitai") === "connected") {
    external.push({ id: "civitai", name: "Civitai", label: "Civitai images", where: "Civitai images" });
  }
  if (state("fal") === "connected") {
    external.push({
      id: "fal",
      name: "FAL",
      label: "AI stills with FAL (paid, asks first)",
      where: "AI stills from your FAL key"
    });
  }
  const own: VisualSourceChoice = {
    id: "own",
    name: "My photos",
    label: "Use my photos",
    where: "your photos"
  };
  const names = external.map((choice) => choice.name);
  const mix: VisualSourceChoice[] = input.ownCount > 0 && external.length > 0
    ? [{
      id: "mix",
      name: "mix",
      label: `Mix my photos and ${andList(names)}`,
      where: `your photos and ${andList(names)}`
    }]
    : [];
  // Photos already added lead; otherwise the connected stock answer leads.
  const choices = input.ownCount > 0 ? [own, ...external, ...mix] : [...external, own, ...mix];
  const remembered = input.remembered;
  const ordered = remembered
    ? [...choices].sort((left, right) =>
      Number(right.id === remembered) - Number(left.id === remembered))
    : choices;
  const locked: string[] = [];
  const unavailable: string[] = [];
  for (const chip of chips) {
    if (chip.id === "more" || chip.id === "own") continue;
    if (chip.state === "locked") locked.push(chip.label);
    if (chip.state === "unavailable") unavailable.push(chip.label);
  }
  const hint = [
    locked.length
      ? `${andList(locked)} ${locked.length === 1 ? "is" : "are"} locked. Add your own key in Sources to use ${locked.length === 1 ? "it" : "them"}.`
      : "",
    unavailable.length
      ? `${andList(unavailable)} ${unavailable.length === 1 ? "is" : "are"} not available here.`
      : ""
  ].filter(Boolean).join(" ");
  return { choices: ordered, connected: names, hint };
}

/** Shared Civitai picker query so filters and cursor paging stay testable. */
export interface CivitaiPickerInput {
  query: string;
  orientation: "portrait" | "landscape";
  username?: string;
  sort: string;
  period: string;
  nsfw: string;
  cursor?: string;
  modelId?: number;
  limit?: number;
}

export function civitaiPickerParams(input: CivitaiPickerInput): URLSearchParams {
  const params = new URLSearchParams({
    q: input.query,
    orientation: input.orientation,
    sort: input.sort,
    period: input.period,
    nsfw: input.nsfw,
    limit: String(input.limit ?? 12)
  });
  if (input.username?.trim()) params.set("username", input.username.trim());
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.modelId) params.set("model_id", String(input.modelId));
  return params;
}

/** Reel setting: turn ready photos into motion with FAL image-to-video (your key). */
export function animateStillsToggleState(input: {
  falConnected: boolean;
  falUnavailable: boolean;
  stillCount: number;
}): { enabled: boolean; reason: string } {
  if (input.falUnavailable) {
    return { enabled: false, reason: "Not available here" };
  }
  if (!input.falConnected) {
    return { enabled: false, reason: "Connect FAL to use this" };
  }
  if (input.stillCount <= 0) {
    return { enabled: false, reason: "Add photos first" };
  }
  return { enabled: true, reason: "Paid · asks first" };
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
