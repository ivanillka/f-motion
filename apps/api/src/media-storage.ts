import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Pool } from "pg";

export interface StoredMedia {
  id: string;
  ownerId: string;
  projectId: string;
  objectKey: string;
  state: string;
}

export class PostgresMediaRepository {
  constructor(readonly pool: Pool) {}

  async insert(asset: StoredMedia): Promise<void> {
    await this.pool.query(
      `INSERT INTO media_integration (id, owner_id, project_id, object_key, state)
       VALUES ($1, $2, $3, $4, $5)`,
      [asset.id, asset.ownerId, asset.projectId, asset.objectKey, asset.state]
    );
  }

  async get(ownerId: string, projectId: string, id: string): Promise<StoredMedia | undefined> {
    const result = await this.pool.query<{
      id: string; owner_id: string; project_id: string; object_key: string; state: string;
    }>(
      `SELECT id, owner_id, project_id, object_key, state
       FROM media_integration WHERE owner_id = $1 AND project_id = $2 AND id = $3`,
      [ownerId, projectId, id]
    );
    const row = result.rows[0];
    return row && { id: row.id, ownerId: row.owner_id, projectId: row.project_id, objectKey: row.object_key, state: row.state };
  }

  async markInspecting(ownerId: string, projectId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE media_integration SET state = 'inspecting'
       WHERE owner_id = $1 AND project_id = $2 AND id = $3 AND state IN ('admitted', 'inspecting')`,
      [ownerId, projectId, id]
    );
    return result.rowCount === 1;
  }
}

export class PrivateObjectStore {
  constructor(readonly client: S3Client, readonly bucket: string) {}
  signedPut(objectKey: string) {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: objectKey }), { expiresIn: 300 });
  }
  async exists(objectKey: string): Promise<boolean> {
    await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    return true;
  }
}
