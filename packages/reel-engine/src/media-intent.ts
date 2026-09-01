import {
  isMediaGlanceHints,
  type MediaGlanceHints,
  type VideoArchitecture
} from "@f-engine/contracts";

export interface SceneMediaIntentInput {
  brief: string;
  caption?: string;
  visual_prompt?: string;
  architecture?: VideoArchitecture;
  glance?: MediaGlanceHints;
}

/** Platform-tailored prompts and tokens that score licensed-stock relevance. */
export interface SceneMediaIntent {
  stock_queries: string[];
  image_prompt: string;
  video_motion_prompt: string;
  speech_script: string;
  intent_tokens: string[];
}

export type MediaIntentAdapter = (input: SceneMediaIntentInput) => SceneMediaIntent | Promise<SceneMediaIntent | undefined>;

let mediaIntentAdapter: MediaIntentAdapter | undefined;

/** Host registers a structured model adapter; deterministic fallback when absent or invalid. */
export function setMediaIntentAdapter(adapter: MediaIntentAdapter | undefined): void {
  mediaIntentAdapter = adapter;
}

export function isSceneMediaIntent(value: unknown): value is SceneMediaIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Array.isArray(item.stock_queries)
    && item.stock_queries.every((query) => typeof query === "string" && query.trim().length > 0)
    && typeof item.image_prompt === "string"
    && item.image_prompt.trim().length > 0
    && item.image_prompt.length <= 500
    && typeof item.video_motion_prompt === "string"
    && item.video_motion_prompt.trim().length > 0
    && item.video_motion_prompt.length <= 500
    && typeof item.speech_script === "string"
    && item.speech_script.trim().length > 0
    && item.speech_script.length <= 2000
    && Array.isArray(item.intent_tokens)
    && item.intent_tokens.every((token) => typeof token === "string" && token.length > 0);
}

export async function resolveSceneMediaIntent(
  input: SceneMediaIntentInput,
  fallback: (value: SceneMediaIntentInput) => SceneMediaIntent
): Promise<SceneMediaIntent> {
  if (mediaIntentAdapter) {
    try {
      const adapted = await mediaIntentAdapter(input);
      if (adapted && isSceneMediaIntent(adapted)) return adapted;
    } catch {
      /* host adapter failed — fall through to deterministic intent */
    }
  }
  return fallback(input);
}

export function glanceMoodWords(glance?: MediaGlanceHints): string[] {
  if (!glance || !isMediaGlanceHints(glance)) return [];
  const mood: string[] = [];
  if (glance.luminance !== undefined && glance.luminance < 0.35) mood.push("low light", "night mood");
  else if (glance.luminance !== undefined && glance.luminance > 0.65) mood.push("bright daylight");
  if (glance.warmth !== undefined && glance.warmth > 0.12) mood.push("warm tones");
  else if (glance.warmth !== undefined && glance.warmth < -0.12) mood.push("cool tones");
  if (glance.orientation === "portrait") mood.push("vertical portrait framing");
  return mood;
}

const FOOTAGE_STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "create", "for", "from", "in", "into", "is", "it", "make",
  "of", "on", "or", "story", "the", "this", "through", "to", "video", "with", "without"
]);

const FOOTAGE_ALIASES = new Map([
  ["cult", "hooded people"], ["cults", "hooded people"], ["culs", "hooded people"],
  ["europe", "european old town"], ["european", "european old town"],
  ["mystery", "mysterious"], ["mysteries", "mysterious"],
  ["sea", "ocean"], ["seas", "ocean"], ["mist", "fog"], ["misty", "fog"], ["foggy", "fog"]
]);

const STOCK_IGNORED_WORDS = new Set([
  ...FOOTAGE_STOP_WORDS,
  "an", "are", "every", "have", "its", "no", "our", "return", "shines", "show",
  "that", "their", "we", "you", "your", "appears", "record", "records"
]);

const STOCK_LOW_SIGNAL_WORDS = new Set([
  "clip", "life", "light", "lights", "map", "maps", "night", "quick"
]);

const STOCK_ALIASES = new Map([
  ...FOOTAGE_ALIASES.entries(),
  ["foggy", "fog"],
  ["islands", "island"],
  ["lighthouses", "lighthouse"],
  ["oceanic", "ocean"]
]);

const TONE_FOOTAGE_WORD: Record<VideoArchitecture["tone"], string> = {
  cinematic: "cinematic",
  documentary: "documentary",
  energetic: "dynamic",
  calm: "peaceful"
};

const TONE_IMAGE_STYLE: Record<VideoArchitecture["tone"], string> = {
  cinematic: "cinematic film lighting, shallow depth of field",
  documentary: "documentary realism, natural light",
  energetic: "dynamic high-energy framing",
  calm: "calm peaceful atmosphere, soft light"
};

const PACE_MOTION_HINT: Record<VideoArchitecture["pace"], string> = {
  slow: "slow subtle camera push, gentle atmospheric motion",
  balanced: "smooth cinematic camera movement",
  fast: "dynamic energetic camera motion, quick visual rhythm"
};

function stockWordTokens(text: string): string[] {
  const words = text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const candidate = STOCK_ALIASES.get(word) ?? word;
    for (const part of candidate.split(" ")) {
      if (part.length < 2 || STOCK_IGNORED_WORDS.has(part) || seen.has(part)) continue;
      seen.add(part);
      result.push(part);
    }
  }
  return result;
}

function trimTo(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max + 1).replace(/\s+\S*$/u, "").trim();
}

/** Short keyword queries for stock APIs (Pexels ranks relevance; supply concrete subjects). */
export function stockQueriesFromText(text: string): string[] {
  const unique = stockWordTokens(text);
  const preferred = unique.filter((word) => !STOCK_LOW_SIGNAL_WORDS.has(word));
  const ranked = [...preferred, ...unique.filter((word) => STOCK_LOW_SIGNAL_WORDS.has(word))];
  const searches = [
    ranked.slice(0, 7).join(" "),
    ranked.slice(0, 4).join(" ")
  ].filter(Boolean);
  return [...new Set(searches.length ? searches : ["cinematic"])];
}

/** Deterministic per-scene media intent; host adapter may override via `resolveSceneMediaIntent`. */
export function sceneMediaIntent(input: SceneMediaIntentInput): SceneMediaIntent {
  const brief = input.brief.trim();
  const caption = input.caption?.trim() ?? "";
  const visual = input.visual_prompt?.trim() ?? "";
  const architecture = input.architecture;
  const glanceMood = glanceMoodWords(input.glance);
  const subject = visual || caption || brief;
  const stockSource = [visual, caption, brief, glanceMood.join(" ")].filter(Boolean).join(" ");
  const stock_queries = stockQueriesFromText(stockSource);
  const intent_tokens = [
    ...stockWordTokens(subject),
    ...stockWordTokens(architecture ? TONE_FOOTAGE_WORD[architecture.tone] : ""),
    ...stockWordTokens(glanceMood.join(" "))
  ].filter((word, index, all) => all.indexOf(word) === index);
  const toneStyle = architecture ? TONE_IMAGE_STYLE[architecture.tone] : "cinematic lighting";
  const audienceFrame = architecture?.audience === "social"
    ? "vertical 9:16 social video composition"
    : "vertical 9:16 portrait composition";
  const image_prompt = trimTo(
    [subject, toneStyle, audienceFrame, glanceMood.join(", ")].filter(Boolean).join(", "),
    500
  );
  const motionBase = architecture
    ? PACE_MOTION_HINT[architecture.pace]
    : "smooth cinematic camera movement";
  const video_motion_prompt = trimTo(
    [motionBase, architecture ? TONE_FOOTAGE_WORD[architecture.tone] : "", glanceMood[0]].filter(Boolean).join(", "),
    500
  );
  const speech_script = trimTo(
    caption || brief || "Tell this story in one clear line.",
    2000
  );
  return { stock_queries, image_prompt, video_motion_prompt, speech_script, intent_tokens };
}

/** 0–100 fit between stock intent tokens and a query plus optional Pexels slug URL. */
export function stockIntentFitScore(
  intent_tokens: readonly string[],
  query: string,
  attributionUrl?: string
): number {
  if (!intent_tokens.length) return 50;
  const intent = new Set(intent_tokens);
  let matched = 0;
  const count = (text: string) => {
    for (const word of stockWordTokens(text)) {
      if (intent.has(word)) matched += 1;
    }
  };
  count(query);
  if (attributionUrl) {
    try {
      const slug = new URL(attributionUrl).pathname
        .replace(/^\/video\//u, "")
        .replace(/-\d+\/?$/u, "")
        .replace(/-/gu, " ");
      count(slug);
    } catch {
      /* ignore malformed attribution URLs */
    }
  }
  return Math.min(100, Math.round((matched / intent_tokens.length) * 100));
}
