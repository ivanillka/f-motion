export const contractVersion = 1 as const;

export type AccountState = "active" | "suspended" | "deletion_pending";
export type MotionPreset = "none" | "push" | "zoom";

export interface CaptionCue {
  text: string;
  start_ms: number;
  end_ms: number;
}

export interface Scene {
  id: string;
  order: number;
  caption: string;
  duration_ms: number;
  focal_x: number;
  focal_y: number;
  motion: MotionPreset;
  audio_level: number;
  ducking: boolean;
  media_id?: string;
  /** Search/generation intent, separate from viewer-facing caption copy. */
  visual_prompt?: string;
  /** Optional timed schedule over `caption`; absent/empty means "derive it". */
  caption_cues?: CaptionCue[];
}

export const stockBeds = [
  { id: "pulse", title: "Funkorama", artist: "Kevin MacLeod", bpm: 115 },
  { id: "drive", title: "Space Fighter Loop", artist: "Kevin MacLeod", bpm: 128 },
  { id: "air", title: "Dreamy Flashback", artist: "Kevin MacLeod", bpm: 80 },
  { id: "glow", title: "Easy Lemon", artist: "Kevin MacLeod", bpm: 110 },
  { id: "night", title: "Wallpaper", artist: "Kevin MacLeod", bpm: 90 },
  { id: "rise", title: "Hot Swing", artist: "Kevin MacLeod", bpm: 140 }
] as const;
export type StockBedId = (typeof stockBeds)[number]["id"];
export const stockBedIds = stockBeds.map((bed) => bed.id);
export const stockMusicCredit = "Music by Kevin MacLeod (incompetech.com) — CC BY 3.0";

export interface Soundtrack {
  kind: "stock" | "upload";
  bpm: number;
  offset_ms: number;
  level: number;
  stock_id?: StockBedId;
  media_id?: string;
}

export type CommandKind =
  | "select_concept"
  | "update_scene"
  | "reorder_scene"
  | "replace_storyboard"
  | "add_scene"
  | "remove_scene"
  | "update_soundtrack";

export interface ProjectSnapshot {
  schema_version: 1;
  id: string;
  owner_id: string;
  revision: number;
  brief: { purpose: string; audience: string; tone: string; soundtrack?: Soundtrack };
  selected_concept_id?: string;
  scenes: Scene[];
}

export interface ProjectSummary {
  id: string;
  revision: number;
  brief: ProjectSnapshot["brief"];
}

export interface CommandEnvelope {
  command_id: string;
  project_id: string;
  base_revision: number;
  client_timestamp: string;
  kind: CommandKind;
  payload: Record<string, unknown>;
}

export interface RenderProgress {
  job_id: string;
  event_id: string;
  phase: "queued" | "preparing" | "rendering" | "uploading" | "complete" | "cancelled";
  percent: number;
}

export interface ApiError {
  type: "conflict" | "validation" | "forbidden" | "not_found";
  message: string;
  authoritative_snapshot?: ProjectSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isSoundtrack(value: unknown): value is Soundtrack {
  if (!isRecord(value)
    || !isFiniteNumber(value.bpm)
    || value.bpm < 60
    || value.bpm > 200
    || !isFiniteNumber(value.offset_ms)
    || value.offset_ms < 0
    || value.offset_ms > 600_000
    || !isFiniteNumber(value.level)
    || value.level < 0
    || value.level > 1) {
    return false;
  }
  if (value.kind === "stock") {
    return typeof value.stock_id === "string" && (stockBedIds as readonly string[]).includes(value.stock_id);
  }
  if (value.kind === "upload") {
    return typeof value.media_id === "string" && !!value.media_id && value.media_id.length <= 80;
  }
  return false;
}

function isCaptionCue(value: unknown, durationMs: number, previousEnd: number): value is CaptionCue {
  if (!isRecord(value)) return false;
  return typeof value.text === "string"
    && !!value.text.trim()
    && isFiniteNumber(value.start_ms)
    && isFiniteNumber(value.end_ms)
    && value.start_ms >= previousEnd
    && value.start_ms < value.end_ms
    && value.end_ms <= durationMs;
}

function isScene(value: unknown, order: number): value is Scene {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !value.id
    || value.order !== order
    || typeof value.caption !== "string"
    || value.caption.length > 180
    || !isFiniteNumber(value.duration_ms)
    || value.duration_ms < 500
    || value.duration_ms > 15_000
    || !isFiniteNumber(value.focal_x)
    || value.focal_x < 0
    || value.focal_x > 1
    || !isFiniteNumber(value.focal_y)
    || value.focal_y < 0
    || value.focal_y > 1
    || !["none", "push", "zoom"].includes(String(value.motion))
    || !isFiniteNumber(value.audio_level)
    || value.audio_level < 0
    || value.audio_level > 1
    || typeof value.ducking !== "boolean"
    || ("media_id" in value && (typeof value.media_id !== "string" || !value.media_id))
    || ("visual_prompt" in value && (typeof value.visual_prompt !== "string"
      || !value.visual_prompt
      || value.visual_prompt !== value.visual_prompt.trim()
      || value.visual_prompt.length > 240))) {
    return false;
  }
  if (!("caption_cues" in value)) return true;
  if (!Array.isArray(value.caption_cues)) return false;
  let previousEnd = 0;
  for (const cue of value.caption_cues) {
    if (!isCaptionCue(cue, value.duration_ms, previousEnd)) return false;
    previousEnd = cue.end_ms;
  }
  return true;
}

/** Validates a planning brief for one beat before persistence as a Scene. */
export interface SceneBrief {
  id: string;
  order: number;
  /** Narrative purpose for this beat (planner-facing). */
  purpose: string;
  caption: string;
  visual_prompt: string;
  duration_ms: number;
  mood?: string;
  camera?: string;
}

export function isSceneBrief(value: unknown): value is SceneBrief {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || !value.id
    || !Number.isInteger(value.order)
    || (value.order as number) < 0
    || typeof value.purpose !== "string"
    || !value.purpose.trim()
    || value.purpose.length > 240
    || typeof value.caption !== "string"
    || value.caption.length > 180
    || typeof value.visual_prompt !== "string"
    || !value.visual_prompt.trim()
    || value.visual_prompt !== value.visual_prompt.trim()
    || value.visual_prompt.length > 240
    || !isFiniteNumber(value.duration_ms)
    || value.duration_ms < 500
    || value.duration_ms > 15_000
    || ("mood" in value && (typeof value.mood !== "string" || value.mood.length > 80))
    || ("camera" in value && (typeof value.camera !== "string" || value.camera.length > 80))) {
    return false;
  }
  return true;
}

/** 4–6 ordered scene briefs with unique IDs, contiguous order, and total ≤ 60s. */
export function isStoryboardPlan(value: unknown): value is SceneBrief[] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 6) return false;
  const ids = new Set<string>();
  let total = 0;
  for (const [order, brief] of value.entries()) {
    if (!isSceneBrief(brief) || brief.order !== order || ids.has(brief.id)) return false;
    ids.add(brief.id);
    total += brief.duration_ms;
  }
  return total >= 4 * 500 && total <= 60_000;
}

/** Validates an authoritative lifecycle payload, not historical empty projects. */
export function isStoryboardScenes(value: unknown, requireVisualPrompt = false): value is Scene[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return false;
  const ids = new Set<string>();
  return value.every((scene, order) => {
    if (!isScene(scene, order) || ids.has(scene.id) || (requireVisualPrompt && !scene.visual_prompt)) return false;
    ids.add(scene.id);
    return true;
  });
}

/** Validates persisted render input at the API/worker trust boundary. */
export function isProjectSnapshot(value: unknown): value is ProjectSnapshot {
  if (!isRecord(value)
    || value.schema_version !== contractVersion
    || typeof value.id !== "string"
    || !value.id
    || typeof value.owner_id !== "string"
    || !value.owner_id
    || !Number.isInteger(value.revision)
    || (value.revision as number) < 0
    || !isRecord(value.brief)
    || typeof value.brief.purpose !== "string"
    || typeof value.brief.audience !== "string"
    || typeof value.brief.tone !== "string"
    || ("soundtrack" in value.brief
      && value.brief.soundtrack != null
      && !isSoundtrack(value.brief.soundtrack))
    || ("selected_concept_id" in value
      && (typeof value.selected_concept_id !== "string" || !value.selected_concept_id))
    || !Array.isArray(value.scenes)) {
    return false;
  }
  return value.scenes.every((scene, order) => isScene(scene, order));
}

export function acceptsFixture(value: unknown): boolean {
  return isProjectSnapshot(value);
}
