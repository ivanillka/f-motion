import { createHash, randomUUID } from "node:crypto";
import type { ProjectSnapshot, SpokenAudioRef, Voiceover } from "@f-engine/contracts";
import {
  SPOKEN_VOICE,
  spokenLineSlots,
  spokenLinesToGenerate,
  spokenMixKey,
  spokenNarrationReady,
  spokenTimelineMs
} from "@f-engine/reel-engine";
import type { PostgresMediaRepository, PrivateObjectStore } from "./media-storage.js";
import { mixSpokenTimeline } from "./speech-wav.js";

/** One spoken line, always SPOKEN_VOICE. Callers do not pick another engine. */
export interface SpokenSynthesisRequest {
  text: string;
  endpoint: typeof SPOKEN_VOICE.endpoint;
  voice: typeof SPOKEN_VOICE.voice;
  speed: typeof SPOKEN_VOICE.speed;
}

export type SpokenSynthesizer = (request: SpokenSynthesisRequest) => Promise<Uint8Array>;

export class SpokenVoiceUnavailableError extends Error {
  constructor() {
    super("spoken voice unavailable");
    this.name = "SpokenVoiceUnavailableError";
  }
}

const inflightLines = new Map<string, Promise<{ mediaId: string; bytes: Uint8Array }>>();

export interface SpokenAudioStore {
  putWav(ownerId: string, projectId: string, bytes: Uint8Array): Promise<string>;
  readWav(ownerId: string, projectId: string, mediaId: string): Promise<Uint8Array | undefined>;
}

const MAX_WAV_BYTES = 8_000_000;

/** Object storage plus a ready media row. Preview and export already play that row. */
export function spokenAudioFromMedia(
  repository: PostgresMediaRepository,
  store: Pick<PrivateObjectStore, "put" | "read">
): SpokenAudioStore {
  return {
    async putWav(ownerId, projectId, bytes) {
      const id = randomUUID();
      const sealedObjectKey = `projects/${projectId}/media-sealed/${id}`;
      const uploaded = await store.put(sealedObjectKey, bytes, "audio/wav", bytes.byteLength);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await repository.pool.query(
        `INSERT INTO "MediaAsset"
           (id, "ownerId", "projectId", "quarantineObjectKey", "sealedObjectKey", "sealedEtag",
            "sealedVersionId", "sealedSha256", state, "declaredType", "maxBytes", detected, attribution)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ready',$9,$10,$11,$12)`,
        [
          id,
          ownerId,
          projectId,
          `projects/${projectId}/media-quarantine/${id}`,
          sealedObjectKey,
          uploaded.etag,
          uploaded.versionId ?? null,
          sha256,
          "audio/wav",
          bytes.byteLength,
          JSON.stringify({ type: "audio/wav", bytes: bytes.byteLength }),
          JSON.stringify({ source: "spoken", generatedAt: new Date().toISOString() })
        ]
      );
      return id;
    },
    async readWav(ownerId, projectId, mediaId) {
      const asset = await repository.get(ownerId, projectId, mediaId);
      if (!asset || asset.state !== "ready" || !asset.sealedObjectKey) return undefined;
      try {
        return await store.read(asset.sealedObjectKey, MAX_WAV_BYTES);
      } catch {
        return undefined;
      }
    }
  };
}

function cachedLines(project: ProjectSnapshot): Map<string, string> {
  const lines = new Map<string, string>();
  for (const item of project.brief.spoken_audio ?? []) {
    if (item.role === "line") lines.set(item.key, item.media_id);
  }
  return lines;
}

function nextSpokenAudio(
  previous: readonly SpokenAudioRef[],
  lines: readonly SpokenAudioRef[],
  mix: SpokenAudioRef
): SpokenAudioRef[] {
  const current = new Set(lines.map((item) => item.key));
  const kept = previous.filter((item) => item.role === "line" && !current.has(item.key));
  const room = Math.max(0, 23 - lines.length);
  return [...lines, ...kept.slice(0, room), mix];
}

function voiceRequest(text: string): SpokenSynthesisRequest {
  return {
    text,
    endpoint: SPOKEN_VOICE.endpoint,
    voice: SPOKEN_VOICE.voice,
    speed: SPOKEN_VOICE.speed
  };
}

/**
 * Attach timeline narration for Spoken captions.
 * Each line is SPOKEN_VOICE speaking that caption. A stored line is reused,
 * so a second open does not synthesize. User-owned voice-over (no spoken_key)
 * is left in place.
 */
export async function ensureSpokenVoiceover(
  ownerId: string,
  project: ProjectSnapshot,
  audio: SpokenAudioStore,
  save: (
    base: ProjectSnapshot,
    voiceover: Voiceover | null,
    spokenAudio: SpokenAudioRef[]
  ) => ProjectSnapshot | Promise<ProjectSnapshot>,
  synthesize?: SpokenSynthesizer
): Promise<{ project: ProjectSnapshot; generated: number }> {
  if (spokenNarrationReady(project)) return { project, generated: 0 };
  const mixKey = spokenMixKey(project.scenes);
  const slots = spokenLineSlots(project.scenes);
  const previousMix = project.brief.spoken_audio?.find((item) => item.role === "mix" && item.key === mixKey);
  const voice = project.brief.voiceover;
  const offset_ms = voice?.spoken_key ? voice.offset_ms : 0;
  const level = voice?.spoken_key ? voice.level : 1;
  if (previousMix) {
    const saved = await save(project, {
      media_id: previousMix.media_id,
      offset_ms,
      level,
      spoken_key: mixKey
    }, project.brief.spoken_audio ?? []);
    return { project: saved, generated: 0 };
  }
  let snapshot = project;
  const cache = cachedLines(snapshot);
  const missing = new Set(spokenLinesToGenerate(slots, [...cache.keys()]));
  if (missing.size > 0 && !synthesize) throw new SpokenVoiceUnavailableError();
  const wavs = new Map<string, Uint8Array>();
  let generated = 0;
  for (const slot of slots) {
    if (wavs.has(slot.key)) continue;
    const mediaId = cache.get(slot.key);
    const stored = !missing.has(slot.key) && mediaId
      ? await audio.readWav(ownerId, snapshot.id, mediaId)
      : undefined;
    if (stored) {
      wavs.set(slot.key, stored);
      continue;
    }
    const fresh = await speakLine(ownerId, snapshot.id, slot.key, slot.text, audio, synthesize!);
    cache.set(slot.key, fresh.mediaId);
    wavs.set(slot.key, fresh.bytes);
    generated += 1;
    const lines = lineRefs(cache, slots);
    snapshot = await save(
      snapshot,
      null,
      nextSpokenAudio(snapshot.brief.spoken_audio ?? [], lines, { role: "mix", key: mixKey, media_id: fresh.mediaId })
        .filter((item) => item.role === "line")
    );
  }
  const mixed = mixSpokenTimeline(spokenTimelineMs(snapshot.scenes), slots, wavs);
  const mixId = await audio.putWav(ownerId, snapshot.id, mixed);
  const lines = lineRefs(cache, slots);
  const saved = await save(snapshot, {
    media_id: mixId,
    offset_ms,
    level,
    spoken_key: mixKey
  }, nextSpokenAudio(snapshot.brief.spoken_audio ?? [], lines, { role: "mix", key: mixKey, media_id: mixId }));
  return { project: saved, generated };
}

function lineRefs(cache: Map<string, string>, slots: readonly { key: string }[]): SpokenAudioRef[] {
  const lines: SpokenAudioRef[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (seen.has(slot.key)) continue;
    seen.add(slot.key);
    const mediaId = cache.get(slot.key);
    if (mediaId) lines.push({ role: "line", key: slot.key, media_id: mediaId });
  }
  return lines;
}

/** One provider call per line, shared by overlapping opens. The stored bytes are the take. */
function speakLine(
  ownerId: string,
  projectId: string,
  key: string,
  text: string,
  audio: SpokenAudioStore,
  synthesize: SpokenSynthesizer
): Promise<{ mediaId: string; bytes: Uint8Array }> {
  const id = `${ownerId}:${projectId}:${key}`;
  const existing = inflightLines.get(id);
  if (existing) return existing;
  const pending = (async () => {
    const bytes = await synthesize(voiceRequest(text));
    const mediaId = await audio.putWav(ownerId, projectId, bytes);
    return { mediaId, bytes };
  })();
  inflightLines.set(id, pending);
  pending.finally(() => {
    if (inflightLines.get(id) === pending) inflightLines.delete(id);
  }).catch(() => undefined);
  return pending;
}
