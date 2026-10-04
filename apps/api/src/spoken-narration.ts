import { createHash, randomUUID } from "node:crypto";
import type { ProjectSnapshot, SpokenAudioRef, Voiceover } from "@f-engine/contracts";
import {
  spokenLineSlots,
  spokenLinesToGenerate,
  spokenMixKey,
  spokenNarrationReady,
  spokenTimelineMs
} from "@f-engine/reel-engine";
import type { PostgresMediaRepository, PrivateObjectStore } from "./media-storage.js";
import { mixSpokenTimeline, synthesizeSpeech } from "./speech-wav.js";

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

/**
 * Attach timeline narration for Spoken captions.
 * A second call with the same lines does not synthesize or store audio.
 * User-owned voice-over (no spoken_key) is left in place.
 */
export async function ensureSpokenVoiceover(
  ownerId: string,
  project: ProjectSnapshot,
  audio: SpokenAudioStore,
  save: (
    base: ProjectSnapshot,
    voiceover: Voiceover,
    spokenAudio: SpokenAudioRef[]
  ) => ProjectSnapshot | Promise<ProjectSnapshot>,
  synthesize: (text: string) => Uint8Array = synthesizeSpeech
): Promise<{ project: ProjectSnapshot; generated: number }> {
  if (spokenNarrationReady(project)) return { project, generated: 0 };
  const mixKey = spokenMixKey(project.scenes);
  const slots = spokenLineSlots(project.scenes);
  const previousMix = project.brief.spoken_audio?.find((item) => item.role === "mix" && item.key === mixKey);
  const voice = project.brief.voiceover;
  if (previousMix) {
    const saved = await save(project, {
      media_id: previousMix.media_id,
      offset_ms: voice?.spoken_key ? voice.offset_ms : 0,
      level: voice?.spoken_key ? voice.level : 1,
      spoken_key: mixKey
    }, project.brief.spoken_audio ?? []);
    return { project: saved, generated: 0 };
  }
  const cache = cachedLines(project);
  const missing = new Set(spokenLinesToGenerate(slots, [...cache.keys()]));
  const wavs = new Map<string, Uint8Array>();
  let generated = 0;
  for (const slot of slots) {
    if (wavs.has(slot.key)) continue;
    const mediaId = cache.get(slot.key);
    const stored = !missing.has(slot.key) && mediaId
      ? await audio.readWav(ownerId, project.id, mediaId)
      : undefined;
    if (stored) {
      wavs.set(slot.key, stored);
      continue;
    }
    const fresh = synthesize(slot.text);
    cache.set(slot.key, await audio.putWav(ownerId, project.id, fresh));
    wavs.set(slot.key, fresh);
    generated += 1;
  }
  const mixed = mixSpokenTimeline(spokenTimelineMs(project.scenes), slots, wavs);
  const mixId = await audio.putWav(ownerId, project.id, mixed);
  const lines = [...wavs.keys()].map((key) => ({
    role: "line" as const,
    key,
    media_id: cache.get(key)!
  }));
  const saved = await save(project, {
    media_id: mixId,
    offset_ms: voice?.spoken_key ? voice.offset_ms : 0,
    level: voice?.spoken_key ? voice.level : 1,
    spoken_key: mixKey
  }, nextSpokenAudio(project.brief.spoken_audio ?? [], lines, { role: "mix", key: mixKey, media_id: mixId }));
  return { project: saved, generated };
}
