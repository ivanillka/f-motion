import {
  buildStoryboardDraft,
  defaultVideoArchitecture,
  type VideoArchitecture
} from "@f-engine/reel-engine";

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
  previewUrl?: string;
}

export {
  buildStoryboardDraft,
  defaultVideoArchitecture,
  type VideoArchitecture
};

/** Prefills the reference UI until a host supplies a reviewed conversation-model adapter. */
export function recommendVideoArchitecture(conversation: string): VideoArchitecture {
  // ponytail: deterministic semantic signals are the ceiling; replace this
  // host-only function with a structured model decision when that adapter exists.
  const text = conversation.normalize("NFKC").toLowerCase();
  const matches = (pattern: RegExp) => pattern.test(text);
  const goal: VideoArchitecture["goal"] = matches(/\b(how to|tutorial|teach|lesson|guide|learn)\b/u)
    ? "educate"
    : matches(/\b(explain|overview|demonstrate|process|why does|how does)\b/u)
      ? "explain"
      : matches(/\b(promote|launch|campaign|advertise|advertising|advertisement|product|service|sale|event)\b/u)
        ? "promote"
        : "story";
  const audience: VideoArchitecture["audience"] = matches(/\b(reel|tiktok|instagram|social media|shorts?)\b/u)
    ? "social"
    : goal === "promote"
      ? "customers"
      : matches(/\b(internal|employees?|colleagues?|our team|staff training)\b/u)
        ? "internal"
        : "general";
  const structure: VideoArchitecture["structure"] = matches(/\b(mystery|mysterious|secret|clues?|unknown|unsolved|abandoned|disappear|lonely island)\b/u)
    ? "mystery"
    : goal === "promote" || matches(/\b(problem|solution|challenge|before and after|result)\b/u)
      ? "problem_solution"
      : matches(/\b(history|timeline|chronological|journey|evolution|life story)\b/u)
        ? "chronological"
        : "story_arc";
  const tone: VideoArchitecture["tone"] = matches(/\b(documentary|facts?|historical|investigation|interview|real story)\b/u)
    ? "documentary"
    : matches(/\b(calm|gentle|soft|peaceful|meditative|serene)\b/u)
      ? "calm"
      : matches(/\b(energetic|dynamic|fast|exciting|bold|action|sport|launch)\b/u)
        ? "energetic"
        : "cinematic";
  const pace: VideoArchitecture["pace"] = matches(/\b(fast|quick|punchy|rapid|high energy)\b/u) || tone === "energetic"
    ? "fast"
    : matches(/\b(slow|atmospheric|quiet|suspense|lonely|fog)\b/u) || tone === "calm" || structure === "mystery"
      ? "slow"
      : "balanced";
  const explicitDuration = text.match(/\b(15|30|45)[\s-]*(?:seconds?|secs?|s)\b/u)?.[1];
  const durationSeconds: VideoArchitecture["durationSeconds"] = explicitDuration
    ? Number(explicitDuration) as VideoArchitecture["durationSeconds"]
    : goal === "promote" || audience === "social"
      ? 15
      : goal === "educate" || goal === "explain" || tone === "documentary"
        ? 45
        : 30;
  const ownMedia = matches(/\b(my|our)\s+(photos?|videos?|footage|media|gallery|assets?|images?)\b/u);
  const externalMedia = matches(/\b(stock|pexels|open source|generated|ai visuals?)\b/u);
  const media: VideoArchitecture["media"] = matches(/\b(mix|mixed|both|combine)\b/u) || (ownMedia && externalMedia)
    ? "mixed"
    : ownMedia
      ? "own"
      : "stock";
  return { goal, audience, structure, tone, pace, durationSeconds, media };
}

/** Uses the inspected clip length while keeping it inside the engine's scene bounds. */
export function sceneDurationForMedia(detectedDurationMs: unknown, fallbackMs: number): number {
  if (typeof detectedDurationMs !== "number" || !Number.isFinite(detectedDurationMs)) return fallbackMs;
  return Math.min(15_000, Math.max(500, Math.round(detectedDurationMs)));
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
