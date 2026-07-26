import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  detected?: { type: string; bytes: number };
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

  async markInspecting(ownerId: string, projectId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE "MediaAsset" SET state = 'inspecting'
        WHERE "ownerId" = $1 AND "projectId" = $2 AND id = $3
          AND state IN ('admitted', 'inspecting')`,
      [ownerId, projectId, id]
    );
    return result.rowCount === 1;
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

  signedPut(objectKey: string, contentType: string) {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: contentType }),
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > maximumMediaBytes) throw new Error("Pexels media rejected");
    const id = randomUUID();
    const asset: StoredMedia = {
      id,
      ownerId,
      projectId,
      objectKey: `projects/${projectId}/media/${id}`,
      state: "ready",
      declaredType: selected.contentType,
      maxBytes: bytes.length,
      detected: { type: selected.contentType, bytes: bytes.length },
      attribution: { source: "Pexels", creator: selected.creator, url: selected.attributionUrl }
    };
    await store.put(asset.objectKey, bytes, selected.contentType);
    await repository.insert(asset);
    return asset;
  }
}
