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

const ARCHITECTURE_FOOTAGE: Record<VideoArchitecture["structure"], string[]> = {
  story_arc: ["wide aerial establishing", "human detail close up", "people in motion", "dramatic turning point", "hopeful outcome", "memorable wide closing"],
  mystery: ["fog wide aerial establishing", "ancient symbol stone close up", "shadowy figure walking", "old documents map investigation", "dramatic silhouette reveal", "empty street dusk fog"],
  problem_solution: ["real environment wide", "person struggling close up", "difficult process detail", "solution demonstration", "visible improvement", "confident outcome wide"],
  chronological: ["historic location wide", "early activity detail", "people making progress", "major change in action", "finished result detail", "modern location wide"]
};

const ARCHITECTURE_CAPTIONS: Record<VideoArchitecture["structure"], string[]> = {
  story_arc: ["The story begins.", "One detail changes everything.", "The situation develops.", "A decisive turn arrives.", "The pieces come together.", "The final image stays with us."],
  mystery: ["The mystery begins.", "The first clue appears.", "The pattern grows harder to explain.", "A hidden connection comes into view.", "The truth is finally revealed.", "Some questions remain."],
  problem_solution: ["The problem is visible.", "Its impact becomes personal.", "The old approach falls short.", "A practical solution emerges.", "The change becomes clear.", "The result speaks for itself."],
  chronological: ["This is where it started.", "The next step followed.", "Progress gathered momentum.", "Then came the turning point.", "The result took shape.", "This is where things stand today."]
};

const FOOTAGE_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "create", "for", "from", "in", "into", "is", "it", "make",
  "of", "on", "or", "story", "the", "this", "through", "to", "video", "with", "without"
]);

const FOOTAGE_ALIASES = new Map([
  ["cult", "hooded people"], ["cults", "hooded people"], ["culs", "hooded people"],
  ["europe", "european old town"], ["european", "european old town"],
  ["mystery", "mysterious"], ["mysteries", "mysterious"],
  ["sea", "ocean"], ["seas", "ocean"], ["mist", "fog"], ["misty", "fog"], ["foggy", "fog"]
]);

const TONE_FOOTAGE_WORD: Record<VideoArchitecture["tone"], string> = {
  cinematic: "cinematic",
  documentary: "documentary",
  energetic: "dynamic",
  calm: "peaceful"
};

function architectureIndexes(sceneCount: number): number[] {
  if (sceneCount === 4) return [0, 1, 4, 5];
  if (sceneCount === 5) return [0, 1, 2, 4, 5];
  return [0, 1, 2, 3, 4, 5];
}

function footageSubject(brief: string): string {
  const words = brief.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (FOOTAGE_STOP_WORDS.has(word)) continue;
    for (const candidate of (FOOTAGE_ALIASES.get(word) ?? word).split(" ")) {
      if (candidate.length < 2 || seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
      if (result.length === 6) return result.join(" ");
    }
  }
  return result.join(" ") || "cinematic subject";
}

function footagePrompt(brief: string, cue: string, tone: VideoArchitecture["tone"]): string {
  const words = `${footageSubject(brief)} ${cue} ${TONE_FOOTAGE_WORD[tone]}`.split(" ");
  const unique = words.filter((word, index) => words.indexOf(word) === index);
  const query = unique.join(" ");
  if (query.length <= 100) return query;
  return query.slice(0, 101).replace(/\s+\S*$/u, "").trim();
}

function subjectCaption(brief: string): string {
  const subject = brief.trim().replace(/[.!?]+$/u, "");
  if (!subject) return "The story begins.";
  return `${subject.charAt(0).toLocaleUpperCase()}${subject.slice(1)}.`.slice(0, 180);
}

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
  const sceneCount = architecture ? (architecture.durationSeconds === 15 ? 4 : architecture.durationSeconds === 30 ? 5 : 6) : 0;
  const architectureSceneIndexes = architecture ? architectureIndexes(sceneCount) : [];
  const visualPrompts = architecture
    ? architectureSceneIndexes.map((roleIndex, index) => footagePrompt(
      fragments[index] ?? brief,
      ARCHITECTURE_FOOTAGE[architecture.structure][roleIndex] ?? "cinematic scene",
      architecture.tone
    ))
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
    const caption = architecture
      ? (fragments[order] ? subjectCaption(fragments[order]) : (order === 0
          ? subjectCaption(brief)
          : ARCHITECTURE_CAPTIONS[architecture.structure][architectureSceneIndexes[order] ?? 0] ?? "The story continues."))
      : words.slice(cursor, cursor + count).join(" ").slice(0, 180);
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
