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
  /** Optional timed schedule over `caption`; absent/empty means "derive it". */
  caption_cues?: CaptionCue[];
}

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
  kind: "select_concept" | "update_scene" | "reorder_scene";
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

export function acceptsFixture(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { schema_version?: unknown }).schema_version === contractVersion;
}
