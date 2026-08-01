export interface Scene {
  id: string;
  order: number;
  caption: string;
  duration_ms: number;
  focal_x: number;
  focal_y: number;
  motion: "none" | "push" | "zoom";
  audio_level: number;
  ducking: boolean;
  media_id?: string;
  visual_prompt?: string;
}

export interface ProjectSnapshot {
  id: string;
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

export interface Concept {
  id: string;
  title: string;
  treatment: string;
}

export interface SceneMediaView {
  id: string;
  state: "admitted" | "inspecting" | "ready" | "quarantined" | "rejected";
  detected?: {
    type?: string;
    bytes?: number;
    width?: number;
    height?: number;
    duration_ms?: number;
  };
  attribution?: {
    source: "Pexels";
    creator: string;
    attributionUrl: string;
    previewUrl?: string;
  };
}

/** Uses the inspected clip length while keeping it inside the engine's scene bounds. */
export function sceneDurationForMedia(detectedDurationMs: unknown, fallbackMs: number): number {
  if (typeof detectedDurationMs !== "number" || !Number.isFinite(detectedDurationMs)) return fallbackMs;
  return Math.min(15_000, Math.max(500, Math.round(detectedDurationMs)));
}

const STORY_ROLES = [
  "wide establishing view",
  "closer environmental detail",
  "key reveal or change",
  "closing wide shot"
] as const;

export interface VideoArchitecture {
  goal: "story" | "explain" | "promote" | "educate";
  audience: "general" | "social" | "customers" | "internal";
  structure: "story_arc" | "mystery" | "problem_solution" | "chronological";
  tone: "cinematic" | "documentary" | "energetic" | "calm";
  pace: "slow" | "balanced" | "fast";
  durationSeconds: 15 | 30 | 45;
  media: "stock" | "own" | "mixed";
}

export const defaultVideoArchitecture: VideoArchitecture = {
  goal: "story",
  audience: "general",
  structure: "story_arc",
  tone: "cinematic",
  pace: "balanced",
  durationSeconds: 15,
  media: "stock"
};

const ARCHITECTURE_ROLES: Record<VideoArchitecture["structure"], string[]> = {
  story_arc: ["opening context", "inciting detail", "development", "key turn", "resolution", "memorable closing image"],
  mystery: ["unanswered opening", "first clue", "growing unease", "key discovery", "reveal", "haunting closing image"],
  problem_solution: ["problem in context", "human impact", "failed or difficult moment", "solution introduced", "proof of change", "clear outcome"],
  chronological: ["earliest moment", "next development", "progression", "turning point", "result", "present-day closing view"]
};

function promptWithRole(brief: string, role: string): string {
  const subject = brief.trim() || "Untitled subject";
  const suffix = ` — ${role}`;
  return `${subject.slice(0, 240 - suffix.length).trim()}${suffix}`;
}

/** Deterministic reference-host draft; it deliberately makes no semantic-AI claim. */
export function buildStoryboardDraft(
  brief: string,
  makeId: () => string = () => crypto.randomUUID(),
  architecture?: VideoArchitecture
): Scene[] {
  const fragments = brief
    .split(/(?:[.!?]+(?:\s+|$)|[,;]\s*)/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12)
    .slice(0, 6);
  const sceneCount = architecture ? (architecture.durationSeconds === 15 ? 4 : architecture.durationSeconds === 30 ? 5 : 6) : undefined;
  const roles = architecture ? ARCHITECTURE_ROLES[architecture.structure].slice(0, sceneCount) : STORY_ROLES;
  const visualPrompts = architecture
    ? roles.map((role, index) => promptWithRole(fragments[index] ?? brief, `${role}, ${architecture.tone} ${architecture.pace} pacing`))
    : fragments.length >= 3
      ? fragments.map((fragment) => fragment.slice(0, 240).trim())
      : STORY_ROLES.map((role) => promptWithRole(brief, role));
  const words = brief.trim() ? brief.trim().split(/\s+/u) : [];
  const base = Math.floor(words.length / visualPrompts.length);
  let remainder = words.length % visualPrompts.length;
  let cursor = 0;
  const totalDurationMs = (architecture?.durationSeconds ?? visualPrompts.length * 3) * 1000;
  const durationBase = Math.floor(totalDurationMs / visualPrompts.length);
  return visualPrompts.map((visual_prompt, order) => {
    const count = base + (remainder-- > 0 ? 1 : 0);
    const caption = words.slice(cursor, cursor + count).join(" ").slice(0, 180);
    cursor += count;
    return {
      id: makeId(),
      order,
      caption,
      visual_prompt,
      duration_ms: durationBase + (order < totalDurationMs % visualPrompts.length ? 1 : 0),
      focal_x: 0.5,
      focal_y: 0.5,
      motion: "none",
      audio_level: 1,
      ducking: false
    };
  });
}

export class ApiResponseError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message ?? `request failed (${status})`));
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  readonly token: () => string;
  readonly onUnauthorized: () => void;

  constructor(
    token: () => string,
    onUnauthorized: () => void = () => undefined
  ) {
    this.token = token;
    this.onUnauthorized = onUnauthorized;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token()}`);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...init, headers });
    const body = response.headers.get("content-type")?.includes("json")
      ? await response.json() as Record<string, unknown>
      : {};
    if (response.status === 401) this.onUnauthorized();
    if (!response.ok) throw new ApiResponseError(response.status, body);
    return body as T;
  }

  command(projectId: string, revision: number, kind: string, payload: Record<string, unknown>) {
    return this.request<ProjectSnapshot>(`/api/projects/${projectId}/commands`, {
      method: "POST",
      body: JSON.stringify({
        command_id: crypto.randomUUID(),
        base_revision: revision,
        client_timestamp: new Date().toISOString(),
        kind,
        payload
      })
    });
  }

  async listProjects() {
    const body = await this.request<{ projects?: ProjectSummary[] }>("/api/projects");
    if (!Array.isArray(body.projects)) throw new Error("invalid projects response");
    return { projects: body.projects };
  }

  getProject(projectId: string) {
    return this.request<{ project: ProjectSnapshot; concepts?: Concept[] }>(`/api/projects/${projectId}`);
  }
}

/** Loads a fresh, project-scoped map so callers replace rather than merge stale media state. */
export async function loadSceneMediaViews(
  api: Pick<ApiClient, "request">,
  project: ProjectSnapshot
): Promise<Record<string, SceneMediaView>> {
  const mediaIds = [...new Set(project.scenes.flatMap(({ media_id: id }) => id ? [id] : []))];
  const views = await Promise.all(mediaIds.map((id) =>
    api.request<SceneMediaView>(`/api/projects/${project.id}/media/${id}`)));
  return Object.fromEntries(views.map((view) => [view.id, view]));
}
