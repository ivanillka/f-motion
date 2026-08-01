import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import type { Pool } from "pg";

export const allowedMediaTypes = new Set(["video/mp4", "image/jpeg", "image/png"]);
export const maximumMediaBytes = 100_000_000;

export interface StoredMedia {
  id: string;
  ownerId: string;
  projectId: string;
  quarantineObjectKey: string;
  sealedObjectKey?: string;
  sealedEtag?: string;
  sealedVersionId?: string;
  sealedSha256?: string;
  state: "admitted" | "inspecting" | "ready" | "quarantined" | "rejected";
  declaredType: string;
  maxBytes: number;
  detected?: {
    type: string;
    bytes: number;
    width?: number;
    height?: number;
    duration_ms?: number;
  };
  attribution?: { source: "Pexels"; creator: string; url: string; previewUrl?: string };
}

export interface SceneMediaView {
  id: string;
  state: StoredMedia["state"];
  detected?: {
    type?: string;
    bytes?: number;
    width?: number;
    height?: number;
    duration_ms?: number;
  };
  attribution?: {
    source: "Pexels";
    creator: string;
    attributionUrl: string;
    previewUrl?: string;
  };
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function safePexelsAttribution(value: unknown): SceneMediaView["attribution"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const attribution = value as Record<string, unknown>;
  const creator = typeof attribution.creator === "string" ? attribution.creator.trim() : "";
  const attributionUrl = safeHttpsUrl(attribution.url);
  if (attribution.source !== "Pexels" || !creator || creator.length > 200 || !attributionUrl) return undefined;
  const previewUrl = safeHttpsUrl(attribution.previewUrl);
  return {
    source: "Pexels",
    creator,
    attributionUrl,
    ...(previewUrl ? { previewUrl } : {})
  };
}

/** Builds the complete client-safe projection; storage keys never cross this boundary. */
export function sceneMediaView(asset: StoredMedia): SceneMediaView {
  const detected = asset.detected && typeof asset.detected === "object"
    ? {
        ...(allowedMediaTypes.has(asset.detected.type) ? { type: asset.detected.type } : {}),
        ...(Number.isInteger(asset.detected.bytes) && asset.detected.bytes > 0 ? { bytes: asset.detected.bytes } : {}),
        ...(Number.isInteger(asset.detected.width) && (asset.detected.width ?? 0) > 0 ? { width: asset.detected.width } : {}),
        ...(Number.isInteger(asset.detected.height) && (asset.detected.height ?? 0) > 0 ? { height: asset.detected.height } : {}),
        ...(Number.isFinite(asset.detected.duration_ms) && (asset.detected.duration_ms ?? 0) >= 0
          ? { duration_ms: asset.detected.duration_ms }
          : {})
      }
    : undefined;
  const attribution = safePexelsAttribution(asset.attribution);
  return {
    id: asset.id,
    state: asset.state,
    ...(detected && Object.keys(detected).length ? { detected } : {}),
    ...(attribution ? { attribution } : {})
  };
}

interface MediaRow {
  id: string;
  ownerId: string;
  projectId: string;
  quarantineObjectKey: string;
  sealedObjectKey?: string;
  sealedEtag?: string;
  sealedVersionId?: string;
  sealedSha256?: string;
  state: StoredMedia["state"];
  declaredType: string;
  maxBytes: number;
  detected?: StoredMedia["detected"];
  attribution?: StoredMedia["attribution"];
}

export class PostgresMediaRepository {
  constructor(readonly pool: Pool) {}

  async insert(asset: StoredMedia): Promise<void> {
    await this.pool.query(
      `INSERT INTO "MediaAsset"
        (id, "ownerId", "projectId", "quarantineObjectKey", state, "declaredType", "maxBytes", detected, attribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        asset.id,
        asset.ownerId,
        asset.projectId,
        asset.quarantineObjectKey,
        asset.state,
        asset.declaredType,
        asset.maxBytes,
        asset.detected ?? null,
        asset.attribution ?? null
      ]
    );
  }

  async get(ownerId: string, projectId: string, id: string): Promise<StoredMedia | undefined> {
    const result = await this.pool.query<MediaRow>(
      `SELECT id, "ownerId", "projectId", "quarantineObjectKey", "sealedObjectKey",
              "sealedEtag", "sealedVersionId", "sealedSha256", state, "declaredType",
              "maxBytes", detected, attribution
         FROM "MediaAsset"
        WHERE "ownerId" = $1 AND "projectId" = $2 AND id = $3`,
      [ownerId, projectId, id]
    );
    return result.rows[0];
  }

  /**
   * Marks the asset `inspecting` and enqueues the inspection work item in one
   * transaction, mirroring `PostgresRenderRepository.create`: a crash between
   * the two writes must not be possible per docs/decisions/queue.md.
   */
  async completeAdmission(ownerId: string, projectId: string, id: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE "MediaAsset" SET state = 'inspecting'
          WHERE "ownerId" = $1 AND "projectId" = $2 AND id = $3
            AND state IN ('admitted', 'inspecting')`,
        [ownerId, projectId, id]
      );
      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `INSERT INTO "WorkOutbox" (id, kind, "dedupeKey", payload)
         VALUES ($1, 'inspect-media', $2, $3)
         ON CONFLICT ("dedupeKey") DO NOTHING`,
        [randomUUID(), `inspect-media:${id}`, { assetId: id, ownerId, projectId }]
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

}

export class PrivateObjectStore {
  constructor(readonly client: S3Client, readonly bucket: string) {}

  signedPut(objectKey: string, contentType: string, contentLength: number) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: contentLength
      }),
      { expiresIn: 300 }
    );
  }

  signedGet(objectKey: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: 300 }
    );
  }

  async put(
    objectKey: string,
    body: Uint8Array | Readable,
    contentType: string,
    contentLength: number
  ): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      ContentLength: contentLength
    }));
  }

  async exists(objectKey: string): Promise<boolean> {
    await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    return true;
  }
}

export interface PexelsResult {
  id: number;
  creator: string;
  attributionUrl: string;
  previewUrl: string;
  sourceUrl: string;
  contentType: string;
}

const pexelsIgnoredWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "create", "every", "for",
  "from", "have", "in", "into", "is", "it", "its", "make", "no", "of", "on", "or",
  "our", "return", "shines", "show", "story", "that", "the", "their", "this",
  "through", "to", "video", "we", "with", "without", "you", "your", "appears",
  "record", "records"
]);

const pexelsWordAliases = new Map([
  ["foggy", "fog"],
  ["islands", "island"],
  ["lighthouses", "lighthouse"],
  ["mist", "fog"],
  ["misty", "fog"],
  ["mystery", "mysterious"],
  ["oceanic", "ocean"],
  ["sea", "ocean"],
  ["seas", "ocean"]
]);

const pexelsLowSignalWords = new Set([
  "clip", "life", "light", "lights", "map", "maps", "night", "quick"
]);

/**
 * Turns narrative copy into short, concrete visual searches. Pexels already
 * ranks by relevance; the application supplies imageable subjects and mood
 * instead of sending prose, calls to action, or production instructions.
 */
export function pexelsQueriesForBrief(brief: string): string[] {
  const words = brief.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const candidate = pexelsWordAliases.get(word) ?? word;
    if (candidate.length < 2 || pexelsIgnoredWords.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    unique.push(candidate);
  }
  const preferred = unique.filter((word) => !pexelsLowSignalWords.has(word));
  const ranked = [
    ...preferred,
    ...unique.filter((word) => pexelsLowSignalWords.has(word))
  ];
  const searches = [
    ranked.slice(0, 7).join(" "),
    ranked.slice(0, 4).join(" ")
  ].filter(Boolean);
  return [...new Set(searches.length ? searches : ["cinematic"])];
}

export class PexelsClient {
  constructor(
    readonly apiKey: string,
    readonly request: typeof fetch = fetch,
    readonly copyDeadlineMs = 30_000,
    readonly temporaryRoot = tmpdir()
  ) {}

  async search(query: string): Promise<PexelsResult[]> {
    const response = await this.request(`https://api.pexels.com/v1/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=12`, {
      headers: { authorization: this.apiKey }
    });
    if (!response.ok) throw new Error("Pexels unavailable");
    const body = await response.json() as {
      videos?: Array<{
        id: number;
        url: string;
        image: string;
        user: { name: string };
        video_files: Array<{ link: string; file_type: string; width: number; file_size?: number }>;
      }>;
    };
    return (body.videos ?? []).flatMap((video) => {
      const file = video.video_files
        .filter(({ file_type: type, file_size: bytes }) =>
          type === "video/mp4" && (bytes === undefined || bytes <= maximumMediaBytes))
        .sort((left, right) => Math.abs(left.width - 1080) - Math.abs(right.width - 1080))[0];
      const creator = video.user.name.trim();
      const attributionUrl = safeHttpsUrl(video.url);
      const previewUrl = safeHttpsUrl(video.image);
      const sourceUrl = safeHttpsUrl(file?.link);
      return file && creator && creator.length <= 200 && attributionUrl && previewUrl && sourceUrl ? [{
        id: video.id,
        creator,
        attributionUrl,
        previewUrl,
        sourceUrl,
        contentType: file.file_type
      }] : [];
    });
  }

  async copy(
    ownerId: string,
    projectId: string,
    selected: PexelsResult,
    repository: PostgresMediaRepository,
    store: PrivateObjectStore
  ): Promise<StoredMedia> {
    const attributionUrl = safeHttpsUrl(selected.attributionUrl);
    const previewUrl = safeHttpsUrl(selected.previewUrl);
    const creator = selected.creator.trim();
    if (!attributionUrl || !previewUrl || !creator || creator.length > 200) {
      throw new Error("Pexels metadata rejected");
    }
    const directory = await mkdtemp(join(this.temporaryRoot, "fengine-pexels-"));
    const path = join(directory, "media");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.copyDeadlineMs);
    timeout.unref();
    let response: Response | undefined;
    try {
      response = await this.request(selected.sourceUrl, { signal: controller.signal });
      if (!response.ok) throw new Error("Pexels media unavailable");
      const bytes = await spoolBoundedBody(response, path, maximumMediaBytes, controller.signal);
      const id = randomUUID();
      const asset: StoredMedia = {
        id,
        ownerId,
        projectId,
        quarantineObjectKey: `projects/${projectId}/media-quarantine/${id}`,
        state: "admitted",
        declaredType: selected.contentType,
        maxBytes: bytes,
        attribution: {
          source: "Pexels",
          creator,
          url: attributionUrl,
          previewUrl
        }
      };
      const upload = createReadStream(path);
      try {
        await store.put(asset.quarantineObjectKey, upload, selected.contentType, bytes);
      } finally {
        upload.destroy();
        await finished(upload).catch(() => undefined);
      }
      await repository.insert(asset);
      if (!await repository.completeAdmission(ownerId, projectId, id)) {
        throw new Error("Pexels media admission failed");
      }
      return { ...asset, state: "inspecting" };
    } finally {
      clearTimeout(timeout);
      controller.abort();
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => undefined);
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
}

/** Spool a response to a private file while enforcing a hard byte ceiling. */
export async function spoolBoundedBody(
  response: Response,
  destination: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<number> {
  const declaredHeader = response.headers.get("content-length");
  const declared = declaredHeader === null ? undefined : Number(declaredHeader);
  if (declared !== undefined && Number.isFinite(declared) && declared > maxBytes) {
    throw new Error("Pexels media rejected");
  }
  if (!response.body) throw new Error("Pexels media unavailable");
  let total = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength;
      callback(total > maxBytes ? new Error("Pexels media rejected") : null, chunk);
    }
  });
  await pipeline(
    Readable.fromWeb(response.body as never),
    counter,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    ...(signal ? [{ signal }] : [])
  );
  if (!total) throw new Error("Pexels media rejected");
  return total;
}
