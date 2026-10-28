import {
  MAX_STORYBOARD_SCENES,
  stockBeds,
  suggestedStockBed,
  stockBedCredit,
  type StockBed,
  type StockBedId
} from "@f-engine/contracts";
import {
  beatGridCuts,
  beatMs,
  buildStoryboardDraft,
  clampBpm,
  conceptIdForArchitecture,
  conceptsFor,
  cueAtElapsed,
  cuesForScene,
  defaultVideoArchitecture,
  recommendVideoArchitecture,
  resolveSceneMediaIntent,
  sceneMediaIntent,
  setMediaIntentAdapter,
  spokenMixKey,
  spokenNarrationReady,
  spokenWordIndex,
  spokenWordsForCues,
  VOICEOVER_DUCK,
  COMMENT_CTA,
  mixPicture,
  parseBeatPattern,
  photoFitTarget,
  photoReelText,
  photosToReelPlan,
  photosToReelScenes,
  photosToReelShotBeats,
  PHOTOS_TO_REEL_MAX_MS,
  PHOTOS_TO_REEL_MOTIONS,
  PHOTOS_TO_REEL_PATTERN,
  PHOTOS_TO_REEL_TITLE,
  PhotoReelTooLongError,
  picturePrompt,
  sceneUsesStock,
  type Concept,
  type MediaGlanceHints,
  type MediaIntentAdapter,
  type PhotoFitLimits,
  type PhotosToReelPlan,
  type VideoArchitecture
} from "@f-engine/reel-engine";

export { beatMs, clampBpm, spokenMixKey, spokenNarrationReady };
export {
  MAX_STORYBOARD_SCENES,
  parseBeatPattern,
  photoFitTarget,
  photoReelText,
  photosToReelPlan,
  photosToReelScenes,
  photosToReelShotBeats,
  PHOTOS_TO_REEL_MAX_MS,
  PHOTOS_TO_REEL_MOTIONS,
  PHOTOS_TO_REEL_PATTERN,
  PHOTOS_TO_REEL_TITLE,
  PhotoReelTooLongError
};
export type { PhotoFitLimits, PhotosToReelPlan };
export { stockBeds, suggestedStockBed, stockBedCredit };
export type { StockBed, StockBedId };

export interface Scene {
  id: string;
  order: number;
  caption: string;
  duration_ms: number;
  focal_x: number;
  focal_y: number;
  motion: "none" | "push" | "zoom" | "zoom_out";
  audio_level: number;
  ducking: boolean;
  media_id?: string;
  visual_prompt?: string;
  title?: string;
  overlay_place?: "bottom" | "center" | "top";
  overlay_look?: "caption" | "title" | "poster" | "spoken";
  picture?: "stock" | "footage" | "document";
}

export interface Soundtrack {
  kind: "stock" | "upload";
  bpm: number;
  offset_ms: number;
  level: number;
  stock_id?: StockBedId;
  media_id?: string;
}

export interface Voiceover {
  media_id: string;
  offset_ms: number;
  level: number;
  /** Set when this file was stored for the current Spoken captions. */
  spoken_key?: string;
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
    cta?: string;
    brand_mark?: boolean;
    frame?: "reel" | "desktop" | "both";
    mix?: true;
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
    source: "Pexels" | "Civitai" | "Mixkit";
    creator: string;
    attributionUrl: string;
    previewUrl?: string;
    postId?: number;
    postUrl?: string;
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
  conceptIdForArchitecture,
  conceptsFor,
  cueAtElapsed,
  cuesForScene,
  spokenWordIndex,
  spokenWordsForCues,
  defaultVideoArchitecture,
  recommendVideoArchitecture,
  setMediaIntentAdapter,
  VOICEOVER_DUCK,
  COMMENT_CTA,
  mixPicture,
  picturePrompt,
  sceneUsesStock,
  type Concept,
  type MediaGlanceHints,
  type MediaIntentAdapter,
  type VideoArchitecture
};

export const briefQuestionIds = ["intent", "audience", "length", "visuals"] as const;
export type BriefQuestionId = (typeof briefQuestionIds)[number];

export interface BriefQuestion {
  id: BriefQuestionId;
  prompt: string;
  choices: readonly string[];
}

/**
 * Picture sources the studio can really offer right now. The Create chat asks
 * about the sources that are connected instead of assuming Pexels.
 */
export interface BriefVisualSources {
  /** Answer labels, in the order to offer them. */
  choices: readonly string[];
  /** Short names of connected external sources, for example ["Pexels", "FAL"]. */
  connected?: readonly string[];
  /** One line about sources that cannot be used yet, or "". */
  hint?: string;
}

export interface BriefChatMessage {
  role: "assistant" | "user";
  text: string;
  questionId?: BriefQuestionId;
  choices?: readonly string[];
}

export const BRIEF_OPENING: BriefChatMessage = {
  role: "assistant",
  text: "What do you want to make? Add photos or describe the video. I will ask only what I still need."
};

/** Offered first after an upload so nobody has to answer every question first. */
export const MAKE_STORYBOARD_NOW = "Make my storyboard now";

export const LOOKING_AT_MEDIA = "Looking at your photos…";
export const DROP_OWN_MEDIA = "Add your photos or clips. I will look at them first, then ask only what is still missing.";
export const BRIEF_READY = "That is enough to make your storyboard."

const briefChoiceSets: Record<BriefQuestionId, readonly string[]> = {
  intent: ["Tell a story", "Explain something", "Promote an idea or product", "Teach the viewer"],
  audience: ["General viewers", "Social media audience", "Customers", "Internal team"],
  length: ["About 15 seconds", "About 30 seconds", "About 45 seconds"],
  visuals: ["Pexels videos", "Use my photos", "Use both photos and Pexels"]
};

function titledPlace(place: string): string {
  return place.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function topicPhrase(value: string): string {
  return value
    .replace(/^(?:i\s+)?(?:need|want)\s+(?:a\s+)?(?:story|video)\s+(?:about|on)\s+/iu, "")
    .replace(/^(?:make|create)\s+(?:a\s+)?(?:story|video)\s+(?:about|on)\s+/iu, "")
    .trim();
}

function clipSubject(value: string): string {
  const text = topicPhrase(value.replace(/[.!?]+$/u, "").trim());
  if (!text) return "this video";
  return text.length > 52 ? `${text.slice(0, 49).trim()}…` : text;
}

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
  const light = mood === "dark" ? "fairly dark" : mood === "bright" ? "fairly bright" : "evenly lit";
  const cast = `${temp} `;
  const frame = portraits >= glances.length / 2
    ? "mostly portrait"
    : landscapes >= glances.length / 2
      ? "mostly landscape"
      : "a mix of shapes";
  const label = stills && clips
    ? `${stills} photos and ${clips} clips`
    : stills
      ? `${stills} photo${stills === 1 ? "" : "s"}`
      : `${clips} clip${clips === 1 ? "" : "s"}`;
  const clipMs = glances.reduce((sum, item) => sum + (item.duration_ms ?? 0), 0);
  const names = glances.map((item) => item.name.replace(/\.[^.]+$/u, "").replace(/[_-]+/gu, " ")).join(", ");
  return [
    `I looked at ${label}.`,
    glances.length === 1
      ? `It is ${frame} and ${light}, with ${cast}light.`
      : `They are ${frame} and ${light}, with ${cast}light.`,
    clipMs >= 500 ? `The clips run about ${Math.round(clipMs / 1000)} seconds.` : "",
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

/** Answers that promise the owner's own photos, alone or mixed with a source. */
const briefOwnMediaAnswer =
  /\buse my photos\b|\bmix my photos\b|\bboth photos and pexels\b/u;

/** Answers that name only an external source, so no local glance is needed. */
const briefExternalOnlyAnswer =
  /\bpexels videos\b|\bcivitai images\b|\bai stills?\b/u;

/** Own-media or mix answers without files: look at the photos before more questions. */
export function briefNeedsMediaLook(conversation: string, fileCount: number): boolean {
  if (fileCount > 0) return false;
  const text = conversation.normalize("NFKC").toLowerCase();
  if (briefOwnMediaAnswer.test(text)) return true;
  if (briefExternalOnlyAnswer.test(text) || /\bpexels\b/u.test(text)) return false;
  return /\b(my|our)\s+(photos?|videos?|footage|clips?)\b/u.test(text);
}

/** Files are present and we have not glanced yet. Skip external-only chats. */
export function briefShouldGlance(conversation: string, fileCount: number): boolean {
  if (fileCount <= 0 || /\bI looked at\b/iu.test(conversation)) return false;
  const text = conversation.normalize("NFKC").toLowerCase();
  if (briefOwnMediaAnswer.test(text)) return true;
  if (briefExternalOnlyAnswer.test(text) || /\bpexels\b/u.test(text)) return false;
  return /\bi added \d+ photos?\./u.test(text)
    || /\b(my|our)\s+(photos?|videos?|footage|clips?)\b/u.test(text);
}

const briefMetaLine = /^(I looked at|I added |File names:|Looking at your photos|That is enough (?:for|to make))/iu;

/** Every static chip answer, so a fixed label never reads as the video topic. */
const briefChipLines = new Set(
  Object.values(briefChoiceSets).flat().map((choice) => choice.toLowerCase())
);

/**
 * Source answers stay answers even when the chat offers a dynamic label list
 * built from the connected sources.
 */
const briefVisualAnswerLine =
  /^(?:use my photos|pexels videos|civitai images|use both photos and pexels|mix my photos\b.*|ai stills?\b.*|ai images?\b.*|my photos\b.*|your photos\b.*)$/u;

export function isBriefAnswerLine(line: string): boolean {
  const text = line.trim().toLowerCase();
  return briefChipLines.has(text) || briefVisualAnswerLine.test(text);
}

/** First user topic, not the later chip answers or glance notes. */
export function briefPurposeFromChat(conversation: string, fileCount = 0): string {
  const first = conversation.split(/\n+/u).map((line) => line.trim()).find((line) =>
    line && !briefMetaLine.test(line) && !isBriefAnswerLine(line)
  ) ?? "";
  const purpose = first.slice(0, 500).trim();
  if (purpose) return purpose;
  if (fileCount > 0) return `Video from ${fileCount} photo${fileCount === 1 ? "" : "s"}`;
  return "";
}

function briefTopicLine(conversation: string): string {
  const topics: string[] = [];
  for (const line of conversation.split(/\n+/u).map((row) => row.trim())) {
    if (!line || briefMetaLine.test(line)) continue;
    if (isBriefAnswerLine(line)) break;
    topics.push(line);
  }
  return topics[topics.length - 1] ?? "";
}

/** First user line plus the plan inferred from every answer so far. */
export function briefTopic(conversation: string): {
  subject: string;
  place: string;
  hook: string;
  plan: VideoArchitecture;
} {
  const first = briefTopicLine(conversation);
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
  return text.startsWith(BRIEF_READY);
}

/**
 * Where the pictures come from, read from the answer the chat actually got.
 * Falls back to the connected sources and then to the architecture's media plan.
 */
export function briefWhereFromChat(
  conversation: string,
  plan: VideoArchitecture,
  sources?: BriefVisualSources
): string {
  const text = conversation.normalize("NFKC").toLowerCase();
  // Keep the owner's own capitalisation for source names in the mix answer.
  const mixed = conversation.normalize("NFKC").match(/\bmix my photos and ([^\n]+)/iu)?.[1]?.trim();
  if (mixed) return `your photos and ${mixed}`;
  if (/\bcivitai images\b/u.test(text)) return "Civitai images";
  if (/\bai stills?\b|\bfal\b/u.test(text)) return "AI stills from your FAL key";
  if (/\buse both photos and pexels\b/u.test(text)) return "your photos and Pexels";
  if (/\bpexels videos\b/u.test(text)) return plan.media === "mixed" ? "your photos and Pexels" : "Pexels videos";
  if (/\buse my photos\b/u.test(text)) return "your photos";
  // Nothing external is connected, so the video can only use own media.
  if (sources && sources.choices.length === 1 && !sources.connected?.length) return "your photos";
  if (plan.media === "own") return "your photos";
  if (plan.media === "mixed") return "your photos and Pexels";
  return "Pexels videos";
}

export function briefReadyMessage(
  conversation: string,
  sources?: BriefVisualSources
): string {
  if (!conversation.trim()) return BRIEF_READY;
  const { plan } = briefTopic(conversation);
  return `${BRIEF_READY} It will run about ${plan.durationSeconds} seconds and use ${briefWhereFromChat(conversation, plan, sources)}.`;
}

export function briefQuestionFor(
  id: BriefQuestionId,
  conversation: string,
  hasOwnMedia: boolean,
  sources?: BriefVisualSources
): BriefQuestion {
  const { subject, place, hook, plan } = briefTopic(conversation);
  const looked = /\bI looked at\b/iu.test(conversation);
  const portrait = /\bportrait\b/iu.test(conversation);
  const about = looked && (subject === "this video" || subject === "your media") ? "this video" : subject;
  if (id === "intent") {
    return {
      id,
      prompt: `What should ${about} be: a story, an explanation, a promotion, or a lesson?`,
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
            ? `How long should ${about} run? About 15, 30, or 45 seconds?`
            : `About how long should ${about} run?`;
    return { id, prompt, choices };
  }
  const connected = sources?.connected ?? [];
  // Only claim stock wording when Pexels is really the source on offer.
  const externalNames = connected.length ? connected.join(" or ") : "Pexels";
  const pexelsOnly = connected.length === 0
    || (connected.length === 1 && connected[0] === "Pexels");
  const stock = pexelsOnly
    ? (place ? `Pexels videos of ${hook}` : "Pexels videos")
    : (place ? `pictures of ${hook} from ${externalNames}` : `pictures from ${externalNames}`);
  const prompt = hasOwnMedia
    ? `Should ${about} use the photos you added, or add ${externalNames} for the other scenes?`
    : plan.structure === "mystery"
      ? `Do you have photos, or should I use ${stock}?`
      : `Where should pictures for ${about} come from?`;
  return {
    id,
    prompt: [prompt, sources?.hint?.trim()].filter(Boolean).join(" "),
    choices: sources?.choices?.length ? sources.choices : briefChoiceSets.visuals
  };
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
  for (const choice of briefChoiceSets.audience) {
    if (text.includes(choice.toLowerCase())) answered.add("audience");
  }
  if (matches(/\b(15|30|45)[\s-]*(?:seconds?|secs?|s)\b/u)) {
    answered.add("length");
  }
  if (
    hasOwnMedia
    || matches(/\b(stock|pexels|civitai|fal|open source|generated|ai visuals?|ai stills?|ai images?)\b/u)
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
  asked: readonly BriefQuestionId[],
  sources?: BriefVisualSources
): BriefQuestion | undefined {
  if (asked.length >= 4) return undefined;
  const answered = answeredBriefQuestions(conversation, hasOwnMedia);
  for (const id of briefQuestionIds) {
    if (answered.has(id) || asked.includes(id)) continue;
    // A single possible source is not a choice: go straight on to the next topic.
    if (id === "visuals" && sources?.choices?.length === 1) continue;
    return briefQuestionFor(id, conversation, hasOwnMedia, sources);
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

  /** Hard-deletes one owned project (DB cascade + best-effort object storage). */
  deleteProject(projectId: string) {
    return this.request<{
      project_id: string;
      deleted: true;
      storage_failures: string[];
    }>(`/api/projects/${projectId}`, { method: "DELETE" });
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

export function clampOffsetMs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(600_000, Math.max(0, Math.round(n)));
}

/** Idle browsing may loop a clip; a live pause must freeze the frame. */
export function previewMediaShouldLoop(livePlaying: boolean, frozen: boolean): boolean {
  return !livePlaying && !frozen;
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

/** One snapped duration per scene, parallel to the input order. */
export function snapScenesToBeat(
  scenes: readonly Pick<Scene, "id" | "order" | "duration_ms">[],
  bpm: unknown
): number[] {
  return beatGridCuts(scenes, bpm).map((cut) => cut.duration_ms);
}

/** Snap one scene through the same cumulative grid (used by previews). */
export function snapDurationToBeat(durationMs: number, bpm: unknown): number {
  return snapScenesToBeat([{ id: "scene", order: 0, duration_ms: durationMs }], bpm)[0]!;
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
