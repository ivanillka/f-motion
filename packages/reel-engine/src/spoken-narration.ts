import type { CaptionCue, Scene } from "@f-engine/contracts";

type SpokenScene = Pick<Scene, "caption" | "duration_ms" | "overlay_look">;

/**
 * The only spoken voice. First line and later lines share this engine,
 * voice, and speed. The line key includes it, so a different engine cannot
 * reuse the take.
 */
export const SPOKEN_VOICE = {
  endpoint: "fal-ai/kokoro/american-english",
  voice: "af_heart",
  speed: 1
} as const;

/** Caption text that should be spoken. Other overlay looks stay silent. */
export function spokenCaption(scene: Pick<Scene, "caption" | "overlay_look">): string {
  if (scene.overlay_look !== "spoken") return "";
  return scene.caption.replace(/\s+/gu, " ").trim();
}

function sceneMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 3_000;
  return Math.min(15_000, Math.max(500, Math.round(durationMs)));
}

/**
 * Silence after the last syllable of a take, so a scene cut cannot clip it.
 * A take of 3.4 seconds therefore plays in a 3.52 second scene.
 */
export const SPOKEN_TAKE_PAD_MS = 120;

/** Longest spoken scene the engine accepts. A take past it fails instead of being crushed. */
export const SPOKEN_TAKE_MAX_MS = 15_000;

/** A cue schedule this close to the take already fits it, so the take keeps it. */
export const SPOKEN_CUE_DRIFT_MS = 250;

/**
 * Scene length for a finished take: the take plus the breath, inside the scene
 * clamp. A take longer than the clamp is an error: resampling it into the scene
 * would raise the pitch, so the cut refuses instead.
 */
export function spokenSceneMsForTake(takeMs: number): number {
  if (!Number.isFinite(takeMs) || takeMs <= 0) throw new Error("spoken take has no audio");
  const take = Math.ceil(takeMs);
  if (take > SPOKEN_TAKE_MAX_MS) {
    throw new Error(`spoken take is ${take}ms, over the ${SPOKEN_TAKE_MAX_MS}ms scene limit`);
  }
  return Math.min(SPOKEN_TAKE_MAX_MS, Math.max(500, take + SPOKEN_TAKE_PAD_MS));
}

/**
 * Cues for one finished take. The line starts with its audio and ends with it,
 * so no word is highlighted while the take is silent. A schedule the editor or
 * planner already wrote is kept when it sits inside the take within
 * `SPOKEN_CUE_DRIFT_MS`; a schedule that runs past the take is replaced, because
 * the take is the clock.
 */
export function spokenTakeCues(
  caption: string,
  takeMs: number,
  existing?: readonly CaptionCue[]
): CaptionCue[] {
  const text = caption.replace(/\s+/gu, " ").trim();
  if (!text) return [];
  const take = Math.max(1, Math.round(takeMs));
  if (existing?.length) {
    const start = existing[0]?.start_ms ?? 0;
    const end = existing[existing.length - 1]?.end_ms ?? 0;
    // Only the same words count as an existing schedule: a cue left over from an
    // edited caption is out of date even if its window happens to fit.
    const sameText = existing
      .map((cue) => cue.text.replace(/\s+/gu, " ").trim())
      .join(" ") === text;
    const fits = sameText
      && start >= 0
      && start <= SPOKEN_CUE_DRIFT_MS
      && end <= take
      && end >= take - SPOKEN_CUE_DRIFT_MS;
    if (fits) return existing.map((cue) => ({ ...cue }));
  }
  return [{ text, start_ms: 0, end_ms: take }];
}

/** One scene patch that makes a Spoken scene follow its take. */
export interface SpokenSceneTiming {
  id: string;
  duration_ms: number;
  caption_cues: CaptionCue[];
}

export function spokenSceneTiming(
  scene: Pick<Scene, "id" | "caption" | "caption_cues">,
  takeMs: number
): SpokenSceneTiming {
  const take = Math.max(1, Math.round(takeMs));
  return {
    id: scene.id,
    duration_ms: spokenSceneMsForTake(take),
    caption_cues: spokenTakeCues(scene.caption, take, scene.caption_cues)
  };
}

/** Stable id for one Spoken line in SPOKEN_VOICE. Case and repeated spaces do not mint a new line. */
export function spokenLineKey(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim().toLowerCase();
  return fnv1a(`${SPOKEN_VOICE.endpoint}\n${SPOKEN_VOICE.voice}\n${SPOKEN_VOICE.speed}\n${normalized}`);
}

/**
 * Fingerprint of where each Spoken line sits on the timeline.
 * Empty when the cut has no Spoken captions.
 */
export function spokenMixKey(scenes: readonly SpokenScene[]): string {
  let start = 0;
  const parts: string[] = [];
  for (const scene of scenes) {
    const duration = sceneMs(scene.duration_ms);
    const text = spokenCaption(scene);
    if (text) parts.push(`${start}:${duration}:${spokenLineKey(text)}`);
    start += duration;
  }
  if (!parts.length) return "";
  return fnv1a(`${SPOKEN_VOICE.endpoint}\n${SPOKEN_VOICE.voice}\n${SPOKEN_VOICE.speed}\n${parts.join("|")}`);
}

export interface SpokenLineSlot {
  text: string;
  key: string;
  startMs: number;
  durationMs: number;
}

/** Spoken lines in timeline order. The same caption twice is two slots and one key. */
export function spokenLineSlots(scenes: readonly SpokenScene[]): SpokenLineSlot[] {
  let start = 0;
  const slots: SpokenLineSlot[] = [];
  for (const scene of scenes) {
    const durationMs = sceneMs(scene.duration_ms);
    const text = spokenCaption(scene);
    if (text) slots.push({ text, key: spokenLineKey(text), startMs: start, durationMs });
    start += durationMs;
  }
  return slots;
}

export function spokenTimelineMs(scenes: readonly SpokenScene[]): number {
  return scenes.reduce((total, scene) => total + sceneMs(scene.duration_ms), 0);
}

/**
 * True when opening this edit must not synthesize.
 * No Spoken lines, a user-owned voice-over, or narration already mixed for this cut.
 */
export function spokenNarrationReady(snapshot: {
  scenes: readonly SpokenScene[];
  brief: { voiceover?: { spoken_key?: string } | null };
}): boolean {
  const key = spokenMixKey(snapshot.scenes);
  if (!key) return true;
  const voice = snapshot.brief.voiceover;
  if (voice && !voice.spoken_key) return true;
  return voice?.spoken_key === key;
}

/** Lines whose stored audio can be reused. */
export function spokenLinesToGenerate(
  slots: readonly SpokenLineSlot[],
  cachedKeys: readonly string[]
): string[] {
  const have = new Set(cachedKeys);
  const needed: string[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (seen.has(slot.key) || have.has(slot.key)) {
      seen.add(slot.key);
      continue;
    }
    seen.add(slot.key);
    needed.push(slot.key);
  }
  return needed;
}

function fnv1a(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
