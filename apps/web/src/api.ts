import {
  buildStoryboardDraft,
  conceptsFor,
  cueAtElapsed,
  cuesForScene,
  defaultVideoArchitecture,
  VOICEOVER_DUCK,
  type Concept,
  type StoryboardSource,
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
    source: "Pexels" | "Pixabay" | "Mixkit";
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
  defaultVideoArchitecture,
  VOICEOVER_DUCK,
  type Concept,
  type StoryboardSource,
  type VideoArchitecture
};

export type ConversationConceptOverlay = { hook?: string; treatment?: string };
export type ConversationConceptOverlays = Partial<Record<"direct" | "story" | "rhythm", ConversationConceptOverlay>>;

export interface CreateConversationPlan {
  architecture: VideoArchitecture;
  source: StoryboardSource;
  concept_overlays?: ConversationConceptOverlays;
}

/** Rule-based plan used when FAL conversation is disconnected or unavailable. */
export function recommendVideoArchitecture(conversation: string): VideoArchitecture {
  // ponytail: keyword rules remain the disconnected fallback; FAL any-llm writes copy when connected.
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

export function applyConversationConceptOverlays(
  concepts: Concept[],
  overlays: ConversationConceptOverlays | undefined
): Concept[] {
  if (!overlays) return concepts;
  return concepts.map((concept) => {
    const overlay = overlays[concept.id as keyof ConversationConceptOverlays];
    if (!overlay) return concept;
    const hook = overlay.hook?.trim();
    const treatment = overlay.treatment?.trim();
    return {
      ...concept,
      hook: hook ? hook.slice(0, 160) : concept.hook,
      treatment: treatment ? treatment.slice(0, 280) : concept.treatment
    };
  });
}

export function storyboardArchitectureForConcept(
  conceptId: string,
  base: VideoArchitecture
): VideoArchitecture {
  if (conceptId === "direct") {
    return { ...base, goal: "promote", structure: "problem_solution", durationSeconds: 15 };
  }
  if (conceptId === "story") {
    return { ...base, goal: "story", structure: "story_arc", durationSeconds: 30 };
  }
  if (conceptId === "rhythm") {
    return { ...base, goal: "story", structure: "chronological", pace: "fast", durationSeconds: 45 };
  }
  return base;
}

export function beatsForConcept(summary: string, sceneCount: number): string[] {
  const steps = summary.split("→").map((part) => {
    const beat = part.trim();
    return beat ? `${beat.charAt(0).toUpperCase()}${beat.slice(1)}` : "";
  }).filter(Boolean);
  const count = Number.isInteger(sceneCount) ? Math.min(8, Math.max(1, sceneCount)) : 1;
  return Array.from({ length: count }, (_, index) => steps[index] ?? `Beat ${index + 1}`);
}

export function mergeConversationStoryboard(engineScenes: Scene[], drafted: Scene[]): Scene[] {
  return drafted.map((scene, index) => {
    const existing = engineScenes[index];
    if (!existing) return scene;
    return {
      ...scene,
      id: existing.id,
      ...(existing.media_id ? { media_id: existing.media_id } : {})
    };
  });
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

/** Client command/scene ids. `crypto.randomUUID` is missing on plain HTTP origins. */
export function clientId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  const clock = bytes[6] ?? 0;
  const variant = bytes[8] ?? 0;
  bytes[6] = (clock & 0x0f) | 0x40;
  bytes[8] = (variant & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Uses the server snapshot after a stale-revision 409 so a lost first click can continue. */
export function snapshotFromConflict(error: unknown, projectId: string): ProjectSnapshot | undefined {
  if (!(error instanceof ApiResponseError) || error.status !== 409) return;
  const snapshot = error.body.authoritative_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return;
  const value = snapshot as Partial<ProjectSnapshot>;
  if (value.id !== projectId || typeof value.revision !== "number" || !Array.isArray(value.scenes)) return;
  return value as ProjectSnapshot;
}

export function stockFillStatus(type: string | undefined): string {
  if (type === "pexels_not_connected" || type === "pixabay_not_connected") {
    return "Connect your Pexels API key in Settings, or upload your own media.";
  }
  if (type === "invalid_provider_credential") {
    return "Pexels rejected this API key. Update it in Settings, or upload your own media.";
  }
  if (type === "provider_unavailable") {
    return "Pexels could not be reached. Find clips in the editor, or try again.";
  }
  return "Licensed media could not be matched. Find or upload clips for each scene.";
}

export function durationSecondsFromClipCount(count: number): 15 | 30 | 45 {
  if (count <= 4) return 15;
  if (count === 5) return 30;
  return 45;
}

export function exportGaps(project: {
  scenes: Array<{ media_id?: string; caption?: string }>;
  brief?: { soundtrack?: unknown; voiceover?: unknown };
}): string[] {
  const gaps: string[] = [];
  const missingMedia = project.scenes.filter((scene) => !scene.media_id).length;
  if (missingMedia) gaps.push(missingMedia === 1 ? "1 scene needs media" : `${missingMedia} scenes need media`);
  if (!project.brief?.voiceover && project.scenes.some((scene) => !scene.caption?.trim())) {
    gaps.push("Add captions or a voice-over");
  }
  if (!project.brief?.soundtrack && !project.brief?.voiceover) gaps.push("Add music or a voice-over");
  return gaps;
}

/** Prefills What you'll say from FAL caption, else the description. */
export function plannedVoiceScript(
  source: { caption?: string } | undefined,
  fallback = ""
): string {
  const caption = source?.caption?.trim();
  if (caption) return caption.slice(0, 1800);
  return fallback.trim().slice(0, 1800);
}

const FAL_SPEECH_LOG: Record<string, string> = {
  quoted: "FAL priced this script.",
  queued: "Queued for generation.",
  submitting: "FAL is generating speech.",
  running: "FAL is synthesizing speech.",
  downloading: "Copying audio into private storage.",
  inspecting: "Checking the audio file.",
  ready: "Voice-over is ready to preview.",
  failed: "Generation failed.",
  cancelled: "Generation cancelled.",
  submission_uncertain: "FAL may have started. Check before retrying."
};
const FAL_SPEECH_TRAIL = ["quoted", "queued", "submitting", "running", "downloading", "inspecting", "ready"] as const;

/** Determinate bar for FAL speech. Running inches forward so a long FAL wait is not a frozen 45%. */
export function falSpeechProgress(state: string, elapsedMs = 0): { percent: number; line: string } {
  const line = FAL_SPEECH_LOG[state] ?? `Status · ${state.replaceAll("_", " ")}`;
  const base: Record<string, number> = {
    quoted: 8,
    queued: 18,
    submitting: 32,
    running: 45,
    downloading: 88,
    inspecting: 94,
    ready: 100,
    failed: 100,
    cancelled: 100,
    submission_uncertain: 100
  };
  let percent = base[state] ?? 0;
  if (state === "submitting") percent = Math.min(80, 32 + Math.floor(Math.max(0, elapsedMs) / 800));
  if (state === "running") percent = Math.min(84, 45 + Math.floor(Math.max(0, elapsedMs) / 3000));
  return { percent, line };
}

export function falSpeechLogTrail(state: string): string[] {
  const index = (FAL_SPEECH_TRAIL as readonly string[]).indexOf(state);
  if (index >= 0) return FAL_SPEECH_TRAIL.slice(0, index + 1).map((step) => FAL_SPEECH_LOG[step]!);
  const terminal = FAL_SPEECH_LOG[state];
  if (!terminal) return [state.replaceAll("_", " ")];
  return [FAL_SPEECH_LOG.quoted!, FAL_SPEECH_LOG.queued!, FAL_SPEECH_LOG.submitting!, terminal];
}

export function captionsFromVoiceScript(
  script: string,
  scenes: Array<{ id: string; duration_ms: number }>
): Array<{ id: string; caption: string }> {
  const words = script.trim().split(/\s+/u).filter(Boolean);
  if (!words.length || !scenes.length) return [];
  const total = scenes.reduce((sum, scene) => sum + Math.max(1, scene.duration_ms), 0);
  let cursor = 0;
  return scenes.map((scene, index) => {
    const share = Math.max(1, scene.duration_ms) / total;
    const take = index === scenes.length - 1
      ? words.length - cursor
      : Math.max(1, Math.round(words.length * share));
    const caption = words.slice(cursor, cursor + take).join(" ").slice(0, 180);
    cursor += take;
    return { id: scene.id, caption };
  });
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

  async requestBlob(path: string): Promise<Blob> {
    const headers = new Headers();
    headers.set("authorization", `Bearer ${this.token()}`);
    const response = await fetch(path, { headers });
    if (response.status === 401) this.onUnauthorized();
    if (!response.ok) {
      const body = response.headers.get("content-type")?.includes("json")
        ? await response.json() as Record<string, unknown>
        : {};
      throw new ApiResponseError(response.status, body);
    }
    return response.blob();
  }

  async putBytes(path: string, body: Blob, contentType: string): Promise<void> {
    const headers = new Headers();
    headers.set("authorization", `Bearer ${this.token()}`);
    headers.set("content-type", contentType);
    const response = await fetch(path, { method: "PUT", headers, body });
    if (response.status === 401) this.onUnauthorized();
    if (!response.ok) {
      const errorBody = response.headers.get("content-type")?.includes("json")
        ? await response.json() as Record<string, unknown>
        : {};
      throw new ApiResponseError(response.status, errorBody);
    }
  }

  async putAdmittedObject(
    projectId: string,
    assetId: string,
    uploadUrl: string,
    body: Blob,
    contentType: string
  ): Promise<void> {
    if (browserCanPut(uploadUrl)) {
      const uploaded = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": contentType },
        body
      });
      if (!uploaded.ok) throw new Error("Upload failed");
      return;
    }
    await this.putBytes(`/api/projects/${projectId}/media/${assetId}/bytes`, body, contentType);
  }

  command(projectId: string, revision: number, kind: string, payload: Record<string, unknown>) {
    return this.request<ProjectSnapshot>(`/api/projects/${projectId}/commands`, {
      method: "POST",
      body: JSON.stringify({
        command_id: clientId(),
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

  planCreateConversation(brief: string) {
    return this.request<CreateConversationPlan>("/api/providers/fal/conversation", {
      method: "POST",
      body: JSON.stringify({ brief })
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

/** Sealed MP4s play as video; Pexels/Pixabay JPEG fallbacks must not, or the player stays black. */
export function previewPlaysAsVideo(media: SceneMediaView | undefined): boolean {
  const url = scenePreviewUrl(media);
  if (!url || media?.detected?.type !== "video/mp4") return false;
  if (!media.previewUrl || media.previewUrl !== url) return false;
  if (url.startsWith("blob:")) return true;
  try {
    const path = new URL(url, "https://local.invalid").pathname.toLowerCase();
    return !/\.(jpe?g|png|webp|gif)$/.test(path);
  } catch {
    return true;
  }
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

export function stockBedForPace(pace: VideoArchitecture["pace"]): (typeof stockBeds)[number] {
  const id = pace === "fast" ? "drive" : pace === "slow" ? "air" : "pulse";
  return stockBeds.find((bed) => bed.id === id) ?? stockBeds[0]!;
}

export function stockBedUrl(id: Soundtrack["stock_id"]): string | undefined {
  return id ? `/music/${id}.mp3` : undefined;
}

/** Presigned MinIO URLs are http://127.0.0.1 on the VPS; the browser must PUT through the API. */
export function browserCanPut(url: string, pageOrigin = globalThis.location?.origin ?? ""): boolean {
  try {
    const target = new URL(url, pageOrigin || undefined);
    if (target.protocol === "https:") return true;
    if (!pageOrigin) return false;
    const here = new URL(pageOrigin);
    const loopback = (host: string) => host === "127.0.0.1" || host === "localhost" || host === "[::1]";
    if (loopback(target.hostname) && loopback(here.hostname)) return true;
    return target.host === here.host;
  } catch {
    return false;
  }
}

/** Loads a fresh, project-scoped map so callers replace rather than merge stale media state. */
export async function loadSceneMediaViews(
  api: Pick<ApiClient, "request"> & Partial<Pick<ApiClient, "requestBlob">>,
  project: ProjectSnapshot,
  previous: Record<string, SceneMediaView> = {}
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
  const next = Object.fromEntries(await Promise.all(views.map(async (view) => [
    view.id,
    await playableScenePreview(api, project.id, view, previous[view.id])
  ])));
  for (const [id, old] of Object.entries(previous)) {
    const kept = next[id]?.previewUrl;
    if (old.previewUrl?.startsWith("blob:") && old.previewUrl !== kept) {
      URL.revokeObjectURL(old.previewUrl);
    }
  }
  return next;
}

async function playableScenePreview(
  api: Pick<ApiClient, "request"> & Partial<Pick<ApiClient, "requestBlob">>,
  projectId: string,
  view: SceneMediaView,
  previous?: SceneMediaView
): Promise<SceneMediaView> {
  if (view.previewUrl || view.state !== "ready" || typeof api.requestBlob !== "function") return view;
  if (previous?.previewUrl?.startsWith("blob:") && previous.state === "ready") {
    return { ...view, previewUrl: previous.previewUrl };
  }
  try {
    const blob = await api.requestBlob(`/api/projects/${projectId}/media/${view.id}/content`);
    return { ...view, previewUrl: URL.createObjectURL(blob) };
  } catch {
    return view;
  }
}
