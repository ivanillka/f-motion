import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export const allowedMediaTypes = new Set(["video/mp4", "image/jpeg", "image/png"]);
export const maximumMediaBytes = 100_000_000;

export interface StoredMedia {
  id: string;
  ownerId: string;
  projectId: string;
  objectKey: string;
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
  attribution?: { source: "Pexels"; creator: string; url: string };
}

interface MediaRow {
  id: string;
  ownerId: string;
  projectId: string;
  objectKey: string;
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
        (id, "ownerId", "projectId", "objectKey", state, "declaredType", "maxBytes", detected, attribution)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        asset.id,
        asset.ownerId,
        asset.projectId,
        asset.objectKey,
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
      `SELECT id, "ownerId", "projectId", "objectKey", state, "declaredType",
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

  async recordInspection(
    ownerId: string,
    projectId: string,
    id: string,
    detected: { type: string; bytes: number }
  ): Promise<StoredMedia | undefined> {
    const asset = await this.get(ownerId, projectId, id);
    if (!asset) return undefined;
    const state = detected.type === asset.declaredType
      && detected.bytes > 0
      && detected.bytes <= asset.maxBytes ? "ready" : "quarantined";
    const result = await this.pool.query<MediaRow>(
      `UPDATE "MediaAsset" SET state = $1, detected = $2
        WHERE "ownerId" = $3 AND "projectId" = $4 AND id = $5
        RETURNING id, "ownerId", "projectId", "objectKey", state, "declaredType",
                  "maxBytes", detected, attribution`,
      [state, detected, ownerId, projectId, id]
    );
    return result.rows[0];
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

  async put(objectKey: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType
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
  sourceUrl: string;
  contentType: string;
}

export class PexelsClient {
  constructor(readonly apiKey: string, readonly request: typeof fetch = fetch) {}

  async search(query: string): Promise<PexelsResult[]> {
    const response = await this.request(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=12`, {
      headers: { authorization: this.apiKey }
    });
    if (!response.ok) throw new Error("Pexels unavailable");
    const body = await response.json() as {
      videos?: Array<{
        id: number;
        url: string;
        user: { name: string };
        video_files: Array<{ link: string; file_type: string; width: number }>;
      }>;
    };
    return (body.videos ?? []).flatMap((video) => {
      const file = video.video_files
        .filter(({ file_type: type }) => type === "video/mp4")
        .sort((left, right) => Math.abs(left.width - 720) - Math.abs(right.width - 720))[0];
      return file ? [{
        id: video.id,
        creator: video.user.name,
        attributionUrl: video.url,
        sourceUrl: file.link,
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
    const response = await this.request(selected.sourceUrl);
    if (!response.ok) throw new Error("Pexels media unavailable");
    const bytes = await readBoundedBody(response, maximumMediaBytes);
    const id = randomUUID();
    const asset: StoredMedia = {
      id,
      ownerId,
      projectId,
      objectKey: `projects/${projectId}/media/${id}`,
      state: "admitted",
      declaredType: selected.contentType,
      maxBytes: bytes.length,
      attribution: { source: "Pexels", creator: selected.creator, url: selected.attributionUrl }
    };
    await store.put(asset.objectKey, bytes, selected.contentType);
    await repository.insert(asset);
    if (!await repository.completeAdmission(ownerId, projectId, id)) {
      throw new Error("Pexels media admission failed");
    }
    return { ...asset, state: "inspecting" };
  }
}

/** Stream a response body while enforcing a hard byte ceiling. */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Pexels media rejected");
  if (!response.body) throw new Error("Pexels media unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Pexels media rejected");
    }
    chunks.push(value);
  }
  if (!total) throw new Error("Pexels media rejected");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
