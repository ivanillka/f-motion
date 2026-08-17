import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { mixkitCatalog, type MixkitTrack } from "./mixkit-catalog.js";
import {
  allowedAudioTypes,
  audioTypeFromBytes,
  ExternalMediaImportError,
  maximumMediaBytes,
  spoolBoundedBody,
  type PostgresMediaRepository,
  type PrivateObjectStore,
  type StoredMedia
} from "./media-storage.js";

export type { MixkitTrack };

const defaultQuery = "urban fashion energetic modern hip hop trap";
const queryAliases: Record<string, string> = {
  trendy: defaultQuery,
  new: defaultQuery,
  viral: defaultQuery,
  lofi: "lo-fi"
};

export function mixkitAudioUrl(id: number): string {
  return `https://assets.mixkit.co/music/${id}/${id}.mp3`;
}

export function musicSearchQuery(value: unknown): string {
  if (value === undefined || value === null || value === "") return defaultQuery;
  if (typeof value !== "string") throw new Error("invalid music query");
  const query = value.trim();
  if (!query) return defaultQuery;
  if (query.length > 80) throw new Error("invalid music query");
  return queryAliases[query.toLowerCase()] ?? query;
}

export function mixkitTrackById(id: unknown): MixkitTrack | undefined {
  const n = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return mixkitCatalog.find((track) => track.id === n);
}

function haystack(track: MixkitTrack): string {
  return `${track.title} ${track.artist} ${track.tags.join(" ")}`.toLowerCase();
}

export function searchMixkitCatalog(query: unknown, limit = 24): MixkitTrack[] {
  const terms = musicSearchQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
  const cap = Math.min(36, Math.max(1, Math.round(limit)));
  return mixkitCatalog
    .map((track) => {
      const text = haystack(track);
      let score = 0;
      for (const term of terms) {
        if (track.title.toLowerCase().includes(term)) score += 4;
        if (track.artist.toLowerCase().includes(term)) score += 2;
        if (text.includes(term)) score += 1;
      }
      return { track, score };
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.track.title.localeCompare(right.track.title))
    .slice(0, cap)
    .map((row) => row.track);
}

export function publicMixkitTrack(track: MixkitTrack) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    tags: track.tags.slice(0, 6),
    page: track.page,
    previewUrl: mixkitAudioUrl(track.id)
  };
}

/** Copies an allowlisted Mixkit MP3 into sealed audio. Client sends catalog id only. */
export async function importMixkitTrack(
  ownerId: string,
  projectId: string,
  track: MixkitTrack,
  store: Pick<PrivateObjectStore, "put" | "copy">,
  repository: Pick<PostgresMediaRepository, "insert" | "markImportedStillReady">,
  request: typeof fetch = fetch,
  temporaryRoot = tmpdir()
): Promise<StoredMedia> {
  const sourceUrl = mixkitAudioUrl(track.id);
  const directory = await mkdtemp(join(temporaryRoot, "fengine-mixkit-"));
  const path = join(directory, "audio.mp3");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  timeout.unref();
  let response: Response | undefined;
  try {
    response = await request(sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "audio/mpeg,*/*;q=0.8" }
    });
    if (!response.ok) throw new ExternalMediaImportError(`licensed music HTTP ${response.status}`);
    const finalUrl = response.url || sourceUrl;
    if (new URL(finalUrl).origin !== "https://assets.mixkit.co") {
      throw new ExternalMediaImportError("licensed music origin is not allowed");
    }
    const bytes = await spoolBoundedBody(response, path, maximumMediaBytes, controller.signal)
      .catch(() => { throw new ExternalMediaImportError("licensed music body rejected"); });
    const head = await readFile(path).then((buffer) => buffer.subarray(0, 16));
    const type = audioTypeFromBytes(head, "audio/mpeg");
    if (type !== "audio/mpeg" || !allowedAudioTypes.has(type)) {
      throw new ExternalMediaImportError("licensed music type rejected");
    }
    const id = randomUUID();
    const asset: StoredMedia = {
      id,
      ownerId,
      projectId,
      quarantineObjectKey: `projects/${projectId}/media-quarantine/${id}`,
      state: "admitted",
      declaredType: type,
      maxBytes: bytes,
      attribution: {
        source: "Mixkit",
        creator: track.artist,
        url: track.page,
        title: track.title
      }
    };
    const upload = createReadStream(path);
    try {
      await store.put(asset.quarantineObjectKey, upload, type, bytes);
    } finally {
      upload.destroy();
      await finished(upload).catch(() => undefined);
    }
    await repository.insert(asset);
    const objectKey = `projects/${projectId}/media-sealed/${id}`;
    const copied = await store.copy(asset.quarantineObjectKey, objectKey);
    const sha256 = createHash("sha256").update(`${asset.quarantineObjectKey}:${copied.etag}:${bytes}`).digest("hex");
    const ready = await repository.markImportedStillReady(
      ownerId,
      projectId,
      id,
      { objectKey, etag: copied.etag, versionId: copied.versionId, sha256 },
      { type, bytes }
    );
    if (!ready) throw new ExternalMediaImportError("licensed music is not reusable");
    return ready;
  } catch (error) {
    if (error instanceof ExternalMediaImportError) throw error;
    throw new ExternalMediaImportError(error instanceof Error ? error.message : "licensed music import failed");
  } finally {
    clearTimeout(timeout);
    controller.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}
