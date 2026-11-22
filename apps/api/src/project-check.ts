import type { ProjectSnapshot } from "@f-engine/contracts";
import { spokenCaption, spokenLineKey, type CheckFacts } from "@f-engine/reel-engine";
import type { PostgresMediaRepository } from "./media-storage.js";
import type { SpokenAudioStore } from "./spoken-narration.js";
import { measureTake } from "./speech-wav.js";

/**
 * Host side of `checkProject`: the facts the snapshot cannot state by itself.
 * A media row that is gone reports `missing`, so a deleted picture and a scene
 * that never had one both read as a problem. Takes are measured from the same
 * WAV bytes the mix plays; a failed read skips the timing check instead of
 * failing the whole report.
 */
export interface CheckFactSources {
  media?: Pick<PostgresMediaRepository, "get">;
  spokenAudio?: Pick<SpokenAudioStore, "readWav">;
}

export async function checkFactsFor(
  ownerId: string,
  snapshot: ProjectSnapshot,
  sources: CheckFactSources
): Promise<CheckFacts> {
  const facts: CheckFacts = {};

  if (sources.media) {
    const media: Record<string, { state: string }> = {};
    const mediaIds = [...new Set(snapshot.scenes.flatMap((scene) => scene.media_id ? [scene.media_id] : []))];
    for (const mediaId of mediaIds) {
      const asset = await sources.media.get(ownerId, snapshot.id, mediaId);
      media[mediaId] = { state: asset?.state ?? "missing" };
    }
    facts.media = media;
  }

  if (sources.spokenAudio) {
    const lineMedia = new Map(
      (snapshot.brief.spoken_audio ?? [])
        .filter((ref) => ref.role === "line")
        .map((ref) => [ref.key, ref.media_id])
    );
    const takes: Record<string, number> = {};
    for (const scene of snapshot.scenes) {
      const text = spokenCaption(scene);
      if (!text) continue;
      const mediaId = lineMedia.get(spokenLineKey(text));
      if (!mediaId) continue;
      const wav = await Promise.resolve(sources.spokenAudio.readWav(ownerId, snapshot.id, mediaId))
        .catch(() => undefined);
      if (!wav) continue;
      try {
        takes[scene.id] = measureTake(wav).durationMs;
      } catch {
        // A stored line that is not readable WAV cannot be measured; the export
        // would fail on it anyway, so leave the timing check out of this report.
      }
    }
    facts.spoken_takes = takes;
  }

  return facts;
}
