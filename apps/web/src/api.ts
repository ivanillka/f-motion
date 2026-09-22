import {
  BRIEF_OPENING_TEXT,
  BRIEF_READY,
  BRIEF_STARTERS,
  advanceBrief,
  briefPurposeFromChat,
  briefQuestionIds,
  briefReadyMessage,
  buildStoryboardDraft,
  conceptIdForArchitecture,
  conceptsFor,
  cueAtElapsed,
  cuesForScene,
  defaultVideoArchitecture,
  isBriefReadyMessage,
  nextBriefQuestion,
  parseBriefAsked,
  recommendVideoArchitecture,
  resolveSceneMediaIntent,
  sceneMediaIntent,
  setMediaIntentAdapter,
  spokenWordIndex,
  spokenWordsForCues,
  VOICEOVER_DUCK,
  type BriefQuestion,
  type BriefQuestionId,
  type BriefTurn,
  type Concept,
  type MediaGlanceHints,
  type MediaIntentAdapter,
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
  brief: {
    purpose: string;
    audience: string;
    tone: string;
    soundtrack?: Soundtrack;
    voiceover?: Voiceover;
    architecture?: VideoArchitecture;
    media_glance?: MediaGlanceHints;
  };
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
  BRIEF_STARTERS,
  advanceBrief,
  briefPurposeFromChat,
  briefQuestionIds,
  briefReadyMessage,
  buildStoryboardDraft,
  conceptIdForArchitecture,
  conceptsFor,
  cueAtElapsed,
  cuesForScene,
  spokenWordIndex,
  spokenWordsForCues,
  defaultVideoArchitecture,
  isBriefReadyMessage,
  nextBriefQuestion,
  recommendVideoArchitecture,
  setMediaIntentAdapter,
  VOICEOVER_DUCK,
  type BriefQuestion,
  type BriefQuestionId,
  type BriefTurn,
  type Concept,
  type MediaGlanceHints,
  type MediaIntentAdapter,
  type VideoArchitecture
};

export interface BriefChatMessage {
  role: "assistant" | "user";
  text: string;
  questionId?: BriefQuestion["id"];
  choices?: readonly string[];
}

export const BRIEF_OPENING: BriefChatMessage = {
  role: "assistant",
  text: BRIEF_OPENING_TEXT,
  questionId: "topic",
  choices: BRIEF_STARTERS
};

export const LOOKING_AT_MEDIA = "Looking at your media…";
export const DROP_OWN_MEDIA = "Drop the photos or clips. I will look at them first, then ask only what is still missing.";
export { BRIEF_READY };

/** ponytail: LAN http installs block crypto.randomUUID outside a secure context; HTTPS fixes it. */
export function newCommandId(): string {
  if (typeof crypto?.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // insecure http context (non-localhost)
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export interface LocalMediaGlance {
  name: string;
  kind: "image" | "video";
  bytes: number;
  width?: number;
  height?: number;
  orientation?: "portrait" | "landscape" | "square";
  duration_ms?: number;
  luminance?: number;
  warmth?: number;
}

export function sampleCanvasStats(data: Uint8ClampedArray | Uint8Array): { luminance: number; warmth: number } {
  let lum = 0;
  let warm = 0;
  let count = 0;
  for (let i = 0; i + 2 < data.length; i += 4) {
    const r = (data[i] ?? 0) / 255;
    const g = (data[i + 1] ?? 0) / 255;
    const b = (data[i + 2] ?? 0) / 255;
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    warm += r - b;
    count += 1;
  }
  return { luminance: count ? lum / count : 0.5, warmth: count ? warm / count : 0 };
}

export function toneFromSample(luminance: number, warmth: number): { mood: "dark" | "bright" | "balanced"; temp: "cool" | "warm" | "neutral" } {
  return {
    mood: luminance < 0.35 ? "dark" : luminance > 0.65 ? "bright" : "balanced",
    temp: warmth < -0.08 ? "cool" : warmth > 0.08 ? "warm" : "neutral"
  };
}

export function mediaNotesFromGlances(glances: readonly LocalMediaGlance[]): string {
  if (!glances.length) return "";
  const stills = glances.filter((item) => item.kind === "image").length;
  const clips = glances.filter((item) => item.kind === "video").length;
  const portraits = glances.filter((item) => item.orientation === "portrait").length;
  const landscapes = glances.filter((item) => item.orientation === "landscape").length;
  const lumValues = glances.map((item) => item.luminance).filter((value): value is number => value != null);
  const warmValues = glances.map((item) => item.warmth).filter((value): value is number => value != null);
  const luminance = lumValues.length ? lumValues.reduce((sum, value) => sum + value, 0) / lumValues.length : 0.5;
  const warmth = warmValues.length ? warmValues.reduce((sum, value) => sum + value, 0) / warmValues.length : 0;
  const { mood, temp } = toneFromSample(luminance, warmth);
  const frame = portraits >= glances.length / 2 ? "portrait" : landscapes >= glances.length / 2 ? "wide" : "mixed framing";
  const label = stills && clips
    ? `${stills} photos and ${clips} clips`
    : stills
      ? `${stills} photo${stills === 1 ? "" : "s"}`
      : `${clips} clip${clips === 1 ? "" : "s"}`;
  const clipMs = glances.reduce((sum, item) => sum + (item.duration_ms ?? 0), 0);
  const names = glances.map((item) => item.name.replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " ")).join(", ");
  return [
    `I looked at ${label}.`,
    `${frame}, ${mood} ${temp} tones.`,
    clipMs >= 500 ? `Clips run about ${Math.round(clipMs / 1000)} seconds.` : "",
    names ? `File names: ${names.slice(0, 160)}.` : ""
  ].filter(Boolean).join(" ");
}

/** Collapses local glances into engine hints for storyboard and media intent. */
export function aggregateMediaGlance(glances: readonly LocalMediaGlance[]): MediaGlanceHints | undefined {
  if (!glances.length) return undefined;
  const portraits = glances.filter((item) => item.orientation === "portrait").length;
  const landscapes = glances.filter((item) => item.orientation === "landscape").length;
  const lumValues = glances.map((item) => item.luminance).filter((value): value is number => value != null);
  const warmValues = glances.map((item) => item.warmth).filter((value): value is number => value != null);
  return {
    ...(lumValues.length ? { luminance: lumValues.reduce((sum, value) => sum + value, 0) / lumValues.length } : {}),
    ...(warmValues.length ? { warmth: warmValues.reduce((sum, value) => sum + value, 0) / warmValues.length } : {}),
    orientation: portraits >= glances.length / 2
      ? "portrait"
      : landscapes >= glances.length / 2
        ? "landscape"
        : undefined
  };
}

/** Own-media or mix answers without files: look at the photos before more questions. */
export function briefNeedsMediaLook(conversation: string, fileCount: number): boolean {
  if (fileCount > 0) return false;
  const text = conversation.normalize("NFKC").toLowerCase();
  if (/\bpexels real stock video\b/u.test(text) && !/\bmy own media\b/u.test(text) && !/\bmix pexels\b/u.test(text)) return false;
  return /\bmy own media\b/u.test(text)
    || /\bmix pexels stock and my media\b/u.test(text)
    || (/\b(my|our)\s+(photos?|videos?|footage|clips?)\b/u.test(text) && !/\bpexels\b/u.test(text));
}

/** Files are present and we have not glanced yet — skip Pexels-only chats. */
export function briefShouldGlance(conversation: string, fileCount: number): boolean {
  if (fileCount <= 0 || /\bI looked at\b/iu.test(conversation)) return false;
  const text = conversation.normalize("NFKC").toLowerCase();
  if (/\bmix pexels stock and my media\b/u.test(text)) return true;
  if (/\bpexels real stock video\b/u.test(text) && !/\bmy own media\b/u.test(text)) return false;
  return /\bmy own media\b/u.test(text)
    || /\bi added \d+ photos?\./u.test(text)
    || (/\b(my|our)\s+(photos?|videos?|footage|clips?)\b/u.test(text) && !/\bpexels\b/u.test(text));
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
    const asked = parseBriefAsked(value.asked);
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
        command_id: newCommandId(),
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

  nextBrief(conversation: string, hasOwnMedia: boolean, asked: readonly BriefQuestionId[]) {
    return this.request<BriefTurn>("/api/briefs/next", {
      method: "POST",
      body: JSON.stringify({
        conversation,
        has_own_media: hasOwnMedia,
        asked
      })
    });
  }

  usage() {
    return this.request<{ balance: number; costs: { preview: number; final: number } }>("/api/me/usage");
  }

  quoteBulk(quantity: number, kind: "preview" | "final" = "final") {
    return this.request<{
      quantity: number;
      kind: "preview" | "final";
      unit: "render_unit";
      per_item: number;
      total: number;
      balance?: number;
      payable?: boolean;
    }>("/api/quotes/bulk", {
      method: "POST",
      body: JSON.stringify({ quantity, kind })
    });
  }

  compose(input: {
    purpose: string;
    audience?: string;
    tone?: string;
    fill_stock?: boolean;
    render?: "preview" | "final" | "none";
  }) {
    return this.request<{
      project_id: string;
      next: "preview_ready" | "draft_only" | "needs_media";
      render?: { job_id: string; phase: string; kind: string; download?: { url: string } };
    }>("/api/compose", {
      method: "POST",
      body: JSON.stringify(input)
    });
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

export async function sceneMediaIntentForScene(
  snapshot: ProjectSnapshot,
  scene: Scene,
  architecture?: VideoArchitecture,
  glance?: MediaGlanceHints
): Promise<Awaited<ReturnType<typeof resolveSceneMediaIntent>>> {
  return resolveSceneMediaIntent({
    brief: snapshot.brief.purpose,
    caption: scene.caption,
    ...(scene.visual_prompt ? { visual_prompt: scene.visual_prompt } : {}),
    architecture: architecture ?? snapshot.brief.architecture,
    glance: glance ?? snapshot.brief.media_glance
  }, sceneMediaIntent);
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
