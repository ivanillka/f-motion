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
    : matches(/\b(slow|atmospheric|quiet|suspense|lonely|fog|dark|night|noir)\b/u) || tone === "calm" || structure === "mystery"
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

export const LOOKING_AT_MEDIA = "Looking at your media…";
export const DROP_OWN_MEDIA = "Drop the photos or clips. I will look at them first, then ask only what is still missing.";
export const BRIEF_READY = "That is enough for a video plan. Continue when you are ready."

const briefChoiceSets: Record<BriefQuestionId, readonly string[]> = {
  intent: ["Tell a story", "Explain something", "Promote an idea or product", "Teach the viewer"],
  audience: ["General viewers", "Social media audience", "Customers", "Internal team"],
  length: ["About 15 seconds", "About 30 seconds", "About 45 seconds"],
  visuals: ["Pexels real stock video", "My own media", "Mix Pexels stock and my media"]
};

function titledPlace(place: string): string {
  return place.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function clipSubject(value: string): string {
  const text = value.replace(/[.!?]+$/u, "").trim();
  if (!text) return "this video";
  return text.length > 52 ? `${text.slice(0, 49).trim()}…` : text;
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

/** First user line plus the plan inferred from every answer so far. */
export function briefTopic(conversation: string): {
  subject: string;
  place: string;
  hook: string;
  plan: VideoArchitecture;
} {
  const first = conversation.split(/\n+/u).map((line) => line.trim()).find((line) =>
    line && !/^(I looked at|I added |File names:|Looking at your media)/iu.test(line)
  ) ?? "";
  const place = (first.match(/\bin\s+([^,.!?]+)$/iu)?.[1] ?? "").trim();
  const looked = /\bI looked at\b/iu.test(conversation);
  const subject = clipSubject(first) === "this video" && looked ? "your media" : clipSubject(first);
  return {
    subject,
    place,
    hook: place ? titledPlace(place) : subject,
    plan: recommendVideoArchitecture(conversation)
  };
}

export function isBriefReadyMessage(text: string): boolean {
  return text.startsWith("That is enough for");
}

export function briefReadyMessage(conversation: string): string {
  if (!conversation.trim()) return BRIEF_READY;
  const { subject, place, hook, plan } = briefTopic(conversation);
  const shape = plan.structure === "mystery"
    ? "mystery"
    : plan.goal === "promote"
      ? "promo"
      : plan.goal === "educate"
        ? "lesson"
        : "story";
  const where = plan.media === "own"
    ? "your media"
    : plan.media === "mixed"
      ? "your media mixed with Pexels"
      : place
        ? `moody ${hook} Pexels stock`
        : "Pexels stock";
  return `That is enough for a ${plan.tone} ${shape} about ${subject} — about ${plan.durationSeconds} seconds, ${where}. Continue when you are ready.`;
}

export function briefQuestionFor(
  id: BriefQuestionId,
  conversation: string,
  hasOwnMedia: boolean
): BriefQuestion {
  const { subject, place, hook, plan } = briefTopic(conversation);
  const looked = /\bI looked at\b/iu.test(conversation);
  const dark = /\bdark\b/iu.test(conversation);
  const portrait = /\bportrait\b/iu.test(conversation);
  const lookHint = [dark ? "dark" : "", portrait ? "portrait" : ""].filter(Boolean).join(", ");
  const about = looked && (subject === "this video" || subject === "your media") ? "your media" : subject;
  if (id === "intent") {
    return {
      id,
      prompt: lookHint
        ? `Your media looks ${lookHint}. Is this a story, an explanation, a promotion, or a lesson?`
        : `Should ${about} be a story, an explanation, a promotion, or a lesson?`,
      choices: briefChoiceSets.intent
    };
  }
  if (id === "audience") {
    const prompt = plan.structure === "mystery"
      ? (place ? `Who is this ${hook} mystery for?` : `Who is this mystery for?`)
      : looked
        ? `Who should see this cut of ${about}?`
        : plan.goal === "promote"
          ? `Who should see ${about}?`
          : plan.goal === "educate"
            ? `Who are you teaching with ${about}?`
            : `Who is ${about} for?`;
    return { id, prompt, choices: briefChoiceSets.audience };
  }
  if (id === "length") {
    const preferred = `About ${plan.durationSeconds} seconds`;
    const choices = [preferred, ...briefChoiceSets.length.filter((choice) => choice !== preferred)];
    const prompt = plan.audience === "social"
      ? `For a reel of ${about}, about 15, 30, or 45 seconds?`
      : looked && portrait
        ? `These are mostly portrait frames. About 15, 30, or 45 seconds?`
        : plan.structure === "mystery"
          ? (place
            ? `Should the ${hook} mystery be a 15-second hook, a 30-second slow reveal, or 45 seconds?`
            : `Should this mystery be a 15-second hook, a 30-second slow reveal, or 45 seconds?`)
          : plan.goal === "promote"
            ? `How long should ${about} run — about 15, 30, or 45 seconds?`
            : `About how long should ${about} run?`;
    return { id, prompt, choices };
  }
  const stock = place ? `moody ${hook} stock from Pexels` : "Pexels stock";
  const prompt = hasOwnMedia
    ? `Use the photos you added for ${about}, mix in Pexels, or switch to stock only?`
    : plan.structure === "mystery"
      ? `Do you have footage, or should we use ${stock}?`
      : `Where should pictures for ${about} come from?`;
  return { id, prompt, choices: briefChoiceSets.visuals };
}

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
    return briefQuestionFor(id, conversation, hasOwnMedia);
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
