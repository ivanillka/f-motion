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

export type CommandKind =
  | "select_concept"
  | "update_scene"
  | "reorder_scene"
  | "replace_storyboard"
  | "add_scene"
  | "remove_scene";

export interface ProjectSnapshot {
  schema_version: 1;
  id: string;
  owner_id: string;
  revision: number;
  brief: { purpose: string; audience: string; tone: string };
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
