import {
  FAL_LLM_DEFAULT_MODEL,
  FalImageError,
  runFalLlm
} from "@f-engine/fal-host";
import type { VideoArchitecture } from "@f-engine/reel-engine";
import {
  falCredentialHttpError,
  type FalCredentialService
} from "./fal-credentials.js";
import { falGenerationHttpError } from "./fal-generation.js";

export class FalConversationValidationError extends Error {
  readonly name = "FalConversationValidationError";
}

export class FalConversationParseError extends Error {
  readonly name = "FalConversationParseError";
}

const BRIEF_MAX = 2000;
const CAPTION_MAX = 2000;
const VISUAL_HINT_MAX = 240;
const HOOK_MAX = 160;
const TREATMENT_MAX = 280;

const GOALS = ["story", "explain", "promote", "educate"] as const;
const AUDIENCES = ["general", "social", "customers", "internal"] as const;
const STRUCTURES = ["story_arc", "mystery", "problem_solution", "chronological"] as const;
const TONES = ["cinematic", "documentary", "energetic", "calm"] as const;
const PACES = ["slow", "balanced", "fast"] as const;
const DURATIONS = [15, 30, 45] as const;
const MEDIA = ["stock", "own", "mixed"] as const;
const CONCEPT_IDS = ["direct", "story", "rhythm"] as const;

export interface ConversationSource {
  caption: string;
  visualHint?: string;
}

export interface ConversationConceptOverlay {
  hook?: string;
  treatment?: string;
}

export type ConversationConceptOverlays = Partial<
  Record<(typeof CONCEPT_IDS)[number], ConversationConceptOverlay>
>;

export interface ConversationPlan {
  architecture: VideoArchitecture;
  source: ConversationSource;
  concept_overlays?: ConversationConceptOverlays;
}

export interface FalConversationPlanner {
  plan(ownerId: string, brief: unknown): Promise<ConversationPlan>;
}

export const FAL_CONVERSATION_SYSTEM_PROMPT = `You plan one short vertical video. Reply with JSON only, no markdown, no extra keys.
{"architecture":{"goal":"story|explain|promote|educate","audience":"general|social|customers|internal","structure":"story_arc|mystery|problem_solution|chronological","tone":"cinematic|documentary|energetic|calm","pace":"slow|balanced|fast","durationSeconds":15,"media":"stock|own|mixed"},"source":{"caption":"on-screen sentences for the whole video","visual_hint":"concrete footage subject"},"concept_overlays":{"direct":{"hook":"...","treatment":"..."},"story":{"hook":"...","treatment":"..."},"rhythm":{"hook":"...","treatment":"..."}}}
durationSeconds must be 15, 30, or 45. caption is readable on-screen copy as short sentences (max 2000 characters). visual_hint is searchable footage words (max 240). Use only concept ids direct, story, and rhythm. Do not invent a fourth concept. Prefer specific, speakable sentences over slogans.`;

function clipText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.normalize("NFKC").trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[]): T | undefined {
  if ((allowed as readonly unknown[]).includes(value)) return value as T;
  if (typeof value === "string") {
    const numeric = Number(value);
    if ((allowed as readonly unknown[]).includes(numeric)) return numeric as T;
  }
  return undefined;
}

function jsonObjectFromLlm(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new FalConversationParseError("invalid conversation output");
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new FalConversationParseError("invalid conversation output");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof FalConversationParseError) throw error;
    throw new FalConversationParseError("invalid conversation output");
  }
}

function overlayFor(value: unknown): ConversationConceptOverlay | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const hook = clipText(raw.hook, HOOK_MAX);
  const treatment = clipText(raw.treatment, TREATMENT_MAX);
  if (!hook && !treatment) return undefined;
  return {
    ...(hook ? { hook } : {}),
    ...(treatment ? { treatment } : {})
  };
}

export function normalizeConversationBrief(value: unknown): string {
  const brief = clipText(value, BRIEF_MAX);
  if (!brief) throw new FalConversationValidationError("Describe the video in your own words.");
  return brief;
}

export function parseConversationPlan(output: string, brief: string): ConversationPlan {
  const record = jsonObjectFromLlm(output);
  const architectureRaw = record.architecture;
  if (!architectureRaw || typeof architectureRaw !== "object" || Array.isArray(architectureRaw)) {
    throw new FalConversationParseError("invalid conversation output");
  }
  const raw = architectureRaw as Record<string, unknown>;
  const goal = oneOf(raw.goal, GOALS);
  const audience = oneOf(raw.audience, AUDIENCES);
  const structure = oneOf(raw.structure, STRUCTURES);
  const tone = oneOf(raw.tone, TONES);
  const pace = oneOf(raw.pace, PACES);
  const durationSeconds = oneOf(raw.durationSeconds ?? raw.duration_seconds ?? raw.duration_sec, DURATIONS);
  const media = oneOf(raw.media, MEDIA);
  if (!goal || !audience || !structure || !tone || !pace || !durationSeconds || !media) {
    throw new FalConversationParseError("invalid conversation output");
  }
  const sourceRaw = record.source && typeof record.source === "object" && !Array.isArray(record.source)
    ? record.source as Record<string, unknown>
    : record;
  const caption = clipText(sourceRaw.caption, CAPTION_MAX) ?? brief;
  const visualHint = clipText(sourceRaw.visual_hint ?? sourceRaw.visualHint, VISUAL_HINT_MAX);
  const overlaysRaw = record.concept_overlays;
  const concept_overlays: ConversationConceptOverlays = {};
  if (overlaysRaw && typeof overlaysRaw === "object" && !Array.isArray(overlaysRaw)) {
    for (const id of CONCEPT_IDS) {
      const overlay = overlayFor((overlaysRaw as Record<string, unknown>)[id]);
      if (overlay) concept_overlays[id] = overlay;
    }
  }
  return {
    architecture: { goal, audience, structure, tone, pace, durationSeconds, media },
    source: {
      caption,
      ...(visualHint ? { visualHint } : {})
    },
    ...(Object.keys(concept_overlays).length ? { concept_overlays } : {})
  };
}

export class FalConversationService implements FalConversationPlanner {
  constructor(
    readonly credentials: FalCredentialService,
    readonly fetchImpl: typeof fetch = fetch,
    readonly model = FAL_LLM_DEFAULT_MODEL
  ) {}

  async plan(ownerId: string, brief: unknown): Promise<ConversationPlan> {
    const normalized = normalizeConversationBrief(brief);
    const { apiKey } = await this.credentials.decryptForOwner(ownerId);
    const output = await runFalLlm(apiKey, {
      prompt: normalized,
      system_prompt: FAL_CONVERSATION_SYSTEM_PROMPT,
      model: this.model
    }, this.fetchImpl);
    return parseConversationPlan(output, normalized);
  }
}

export function falConversationHttpError(error: unknown): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof FalConversationValidationError) {
    return { status: 422, body: { type: "validation", message: error.message || "Describe the video in your own words." } };
  }
  if (error instanceof FalConversationParseError) {
    return { status: 503, body: { type: "provider_unavailable", message: "FAL conversation was unavailable." } };
  }
  if (error instanceof FalImageError) {
    const mapped = falGenerationHttpError(error);
    if (mapped) return mapped;
  }
  return falGenerationHttpError(error) ?? falCredentialHttpError(error);
}
