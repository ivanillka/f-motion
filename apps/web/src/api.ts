import {
  buildStoryboardDraft,
  conceptsFor,
  cueAtElapsed,
  cuesForScene,
  defaultVideoArchitecture,
  spokenWordIndex,
  spokenWordsForCues,
  VOICEOVER_DUCK,
  type Concept,
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
  title?: string;
  overlay_place?: "bottom" | "center" | "top";
  overlay_look?: "caption" | "title" | "poster";
}

export interface Soundtrack {
  kind: "stock" | "upload";
  bpm: number;
  offset_ms: number;
  level: number;
  stock_id?: "pulse" | "drive" | "air" | "glow" | "night" | "rise";
  media_id?: string;
}

export interface Voiceover {
  media_id: string;
  offset_ms: number;
  level: number;
}

export interface ProjectSnapshot {
  id: string;
  revision: number;
  brief: { purpose: string; audience: string; tone: string; soundtrack?: Soundtrack; voiceover?: Voiceover };
  selected_concept_id?: string;
  scenes: Scene[];
}

export interface ProjectSummary {
  id: string;
  revision: number;
  brief: ProjectSnapshot["brief"];
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
    source: "Pexels" | "Mixkit";
    creator: string;
    attributionUrl: string;
    previewUrl?: string;
    title?: string;
  };
  generation?: {
    source: "FAL";
    model: string;
    generatedAt: string;
    derivedFromImage?: true;
  };
  previewUrl?: string;
}

export {
  buildStoryboardDraft,
  conceptsFor,
  cueAtElapsed,
  cuesForScene,
  spokenWordIndex,
  spokenWordsForCues,
  defaultVideoArchitecture,
  VOICEOVER_DUCK,
  type Concept,
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
  const structure: VideoArchitecture["structure"] = matches(/\b(mystery|mysterious|secret|clues?|unknown|unsolved|abandoned|disappear|lonely island|murder)\b/u)
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

export const briefQuestionIds = ["intent", "audience", "length", "visuals"] as const;
export type BriefQuestionId = (typeof briefQuestionIds)[number];

export interface BriefQuestion {
  id: BriefQuestionId;
  prompt: string;
  choices: readonly string[];
}

export interface BriefChatMessage {
  role: "assistant" | "user";
  text: string;
  questionId?: BriefQuestionId;
  choices?: readonly string[];
}

export const BRIEF_OPENING: BriefChatMessage = {
  role: "assistant",
  text: "What do you want to make? Drop photos or describe the video. I will ask only what I still need."
};

export const BRIEF_READY = "That is enough for a video plan. Change anything under More settings, or continue to story concepts.";

export const briefQuestions: Record<BriefQuestionId, BriefQuestion> = {
  intent: {
    id: "intent",
    prompt: "Is this a story, an explanation, a promotion, or a lesson?",
    choices: ["Tell a story", "Explain something", "Promote an idea or product", "Teach the viewer"]
  },
  audience: {
    id: "audience",
    prompt: "Who is this for?",
    choices: ["General viewers", "Social media audience", "Customers", "Internal team"]
  },
  length: {
    id: "length",
    prompt: "About how long should it run?",
    choices: ["About 15 seconds", "About 30 seconds", "About 45 seconds"]
  },
  visuals: {
    id: "visuals",
    prompt: "Where should the pictures come from?",
    choices: ["Pexels real stock video", "My own media", "Mix Pexels stock and my media"]
  }
};

export function answeredBriefQuestions(conversation: string, hasOwnMedia: boolean): Set<BriefQuestionId> {
  const text = conversation.normalize("NFKC").toLowerCase();
  const matches = (pattern: RegExp) => pattern.test(text);
  const answered = new Set<BriefQuestionId>();
  if (matches(/\b(how to|tutorial|teach|lesson|guide|learn|explain|overview|demonstrate|process|why does|how does|promote|launch|campaign|advertise|advertising|advertisement|product|service|sale|event|story|mystery|murder|tale|narrative)\b/u)) {
    answered.add("intent");
  }
  if (matches(/\b(reel|tiktok|instagram|social media|shorts?|customers?|internal|employees?|colleagues?|our team|staff training|general viewers?)\b/u)) {
    answered.add("audience");
  }
  if (matches(/\b(15|30|45)[\s-]*(?:seconds?|secs?|s)\b/u)) {
    answered.add("length");
  }
  if (
    hasOwnMedia
    || matches(/\b(stock|pexels|open source|generated|ai visuals?)\b/u)
    || matches(/\b(my|our)\s+(photos?|videos?|footage|media|gallery|assets?|images?)\b/u)
    || matches(/\bmy own media\b/u)
  ) {
    answered.add("visuals");
  }
  return answered;
}

export function nextBriefQuestion(
  conversation: string,
  hasOwnMedia: boolean,
  asked: readonly BriefQuestionId[]
): BriefQuestion | undefined {
  if (asked.length >= 4) return undefined;
  const answered = answeredBriefQuestions(conversation, hasOwnMedia);
  for (const id of briefQuestionIds) {
    if (answered.has(id) || asked.includes(id)) continue;
    return briefQuestions[id];
  }
  return undefined;
}

export function parseBriefChat(raw: string | null): {
  messages: BriefChatMessage[];
  asked: BriefQuestionId[];
  composer: string;
} {
  const opening = { messages: [BRIEF_OPENING], asked: [] as BriefQuestionId[], composer: "" };
  if (!raw) return opening;
  try {
    const value = JSON.parse(raw) as {
      messages?: unknown;
      asked?: unknown;
      composer?: unknown;
    };
    const messages = Array.isArray(value.messages)
      ? value.messages.filter((item): item is BriefChatMessage =>
        !!item && typeof item === "object" && (item.role === "assistant" || item.role === "user") && typeof item.text === "string")
      : [];
    const asked = Array.isArray(value.asked)
      ? value.asked.filter((item): item is BriefQuestionId => briefQuestionIds.includes(item as BriefQuestionId))
      : [];
    const composer = typeof value.composer === "string" ? value.composer.slice(0, 500) : "";
    return { messages: messages.length ? messages : opening.messages, asked, composer };
  } catch {
    return opening;
  }
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

  /** Stable wire `type` when the API returned a typed error body. */
  get type(): string | undefined {
    return typeof this.body.type === "string" ? this.body.type : undefined;
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

export function clampFocus(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function isWideMedia(width?: number, height?: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && Number(width) > Number(height);
}

export function panFocus(
  start: { x: number; y: number },
  delta: { x: number; y: number }
): { x: number; y: number } {
  return { x: clampFocus(start.x - delta.x), y: clampFocus(start.y - delta.y) };
}

export function focusFromPoint(
  point: { x: number; y: number },
  box: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: clampFocus(box.width <= 0 ? 0.5 : point.x / box.width),
    y: clampFocus(box.height <= 0 ? 0.5 : point.y / box.height)
  };
}

export function scenePreviewUrl(media: SceneMediaView | undefined): string | undefined {
  return media?.previewUrl ?? media?.attribution?.previewUrl;
}

export function nextLiveSceneId(sceneIds: readonly string[], currentId: string): string {
  if (!sceneIds.length) return currentId;
  const index = sceneIds.indexOf(currentId);
  const from = index < 0 ? 0 : index;
  return sceneIds[(from + 1) % sceneIds.length] ?? sceneIds[0]!;
}

export function previousLiveSceneId(sceneIds: readonly string[], currentId: string): string {
  if (!sceneIds.length) return currentId;
  const index = sceneIds.indexOf(currentId);
  const from = index < 0 ? 0 : index;
  return sceneIds[(from - 1 + sceneIds.length) % sceneIds.length] ?? sceneIds[0]!;
}

export function boundedSceneMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 3_000;
  return Math.min(15_000, Math.max(500, durationMs));
}

export function formatPlayTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function liveTimeline(scenes: readonly Pick<Scene, "id" | "duration_ms">[]): {
  totalMs: number;
  offsets: number[];
  durations: number[];
} {
  const durations = scenes.map((scene) => boundedSceneMs(scene.duration_ms));
  const offsets: number[] = [];
  let totalMs = 0;
  for (const duration of durations) {
    offsets.push(totalMs);
    totalMs += duration;
  }
  return { totalMs, offsets, durations };
}

/** Clock for the voice-over element. Unknown duration is still loading, not finished. */
export function voiceoverPlayback(
  timelineMs: number,
  trimMs: number,
  durationSec: number | undefined
): { play: true; currentTime?: number } | { play: false } {
  const at = (Math.max(0, timelineMs) + Math.max(0, trimMs)) / 1000;
  if (durationSec == null || !(durationSec > 0)) return { play: true };
  if (at >= durationSec) return { play: false };
  return { play: true, currentTime: at };
}

export function livePlayhead(
  scenes: readonly Pick<Scene, "id" | "duration_ms">[],
  playSceneId: string,
  sceneElapsedMs: number
): { offsetMs: number; sceneElapsedMs: number; totalMs: number } {
  const { totalMs, offsets, durations } = liveTimeline(scenes);
  const index = Math.max(0, scenes.findIndex((scene) => scene.id === playSceneId));
  const duration = durations[index] ?? 0;
  const elapsed = Math.min(duration, Math.max(0, sceneElapsedMs));
  return { offsetMs: (offsets[index] ?? 0) + elapsed, sceneElapsedMs: elapsed, totalMs };
}

export function seekLivePlayhead(
  scenes: readonly Pick<Scene, "id" | "duration_ms">[],
  timeMs: number
): { sceneId: string; sceneElapsedMs: number } {
  if (!scenes.length) return { sceneId: "", sceneElapsedMs: 0 };
  const { totalMs, durations } = liveTimeline(scenes);
  let remaining = Math.min(totalMs, Math.max(0, timeMs));
  for (const [index, scene] of scenes.entries()) {
    const duration = durations[index] ?? 0;
    if (remaining < duration || index === scenes.length - 1) {
      return { sceneId: scene.id, sceneElapsedMs: Math.min(duration, remaining) };
    }
    remaining -= duration;
  }
  const last = scenes[scenes.length - 1]!;
  return { sceneId: last.id, sceneElapsedMs: boundedSceneMs(last.duration_ms) };
}

export function clampBpm(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 120;
  return Math.min(200, Math.max(60, Math.round(n)));
}

export function clampOffsetMs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(600_000, Math.max(0, Math.round(n)));
}

/** Idle browsing may loop a clip; a live pause must freeze the frame. */
export function previewMediaShouldLoop(livePlaying: boolean, frozen: boolean): boolean {
  return !livePlaying && !frozen;
}

export function defaultVoiceoverPrompt(snapshot: {
  brief: { purpose: string };
  scenes: readonly { caption: string }[];
}): string {
  const spoken = snapshot.scenes.map((scene) => scene.caption.trim()).filter(Boolean).join("\n").trim();
  return (spoken || snapshot.brief.purpose.trim() || "Tell this story in one clear line.").slice(0, 2000);
}

export function beatMs(bpm: unknown): number {
  return 60_000 / clampBpm(bpm);
}

export function snapDurationToBeat(durationMs: number, bpm: unknown): number {
  const beat = beatMs(bpm);
  const beats = Math.max(1, Math.round(boundedSceneMs(durationMs) / beat));
  return boundedSceneMs(beats * beat);
}

export function musicLaneBeats(totalMs: number, bpm: unknown): number[] {
  const beat = beatMs(bpm);
  const marks: number[] = [];
  for (let t = 0; t <= totalMs + 0.5; t += beat) marks.push(t / Math.max(1, totalMs));
  return marks;
}

export function jwtEmail(token: string): string {
  const part = token.split(".")[1];
  if (!part) return "";
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  } catch {
    return "";
  }
}

export function showsPartnerBrands(token: string, allowed: string): boolean {
  const want = allowed.trim().toLowerCase();
  return Boolean(want) && jwtEmail(token) === want;
}

export const stockBeds = [
  { id: "pulse" as const, label: "Funkorama", hint: "Kevin MacLeod", bpm: 115 },
  { id: "drive" as const, label: "Space Fighter Loop", hint: "Kevin MacLeod", bpm: 128 },
  { id: "air" as const, label: "Dreamy Flashback", hint: "Kevin MacLeod", bpm: 80 },
  { id: "glow" as const, label: "Easy Lemon", hint: "Kevin MacLeod", bpm: 110 },
  { id: "night" as const, label: "Wallpaper", hint: "Kevin MacLeod", bpm: 90 },
  { id: "rise" as const, label: "Hot Swing", hint: "Kevin MacLeod", bpm: 140 }
];

export function stockBedUrl(id: Soundtrack["stock_id"]): string | undefined {
  return id ? `/music/${id}.mp3` : undefined;
}

/** Loads a fresh, project-scoped map so callers replace rather than merge stale media state. */
export async function loadSceneMediaViews(
  api: Pick<ApiClient, "request">,
  project: ProjectSnapshot
): Promise<Record<string, SceneMediaView>> {
  const soundtrackId = project.brief.soundtrack?.kind === "upload" ? project.brief.soundtrack.media_id : undefined;
  const voiceoverId = project.brief.voiceover?.media_id;
  const mediaIds = [...new Set([
    ...project.scenes.flatMap(({ media_id: id }) => id ? [id] : []),
    ...(soundtrackId ? [soundtrackId] : []),
    ...(voiceoverId ? [voiceoverId] : [])
  ])];
  const views = await Promise.all(mediaIds.map((id) =>
    api.request<SceneMediaView>(`/api/projects/${project.id}/media/${id}`)));
  return Object.fromEntries(views.map((view) => [view.id, view]));
}
