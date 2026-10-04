import type { Scene } from "@f-engine/contracts";

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
