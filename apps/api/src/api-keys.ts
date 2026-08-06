import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";

export interface ApiKeyView {
  id: string;
  label: string;
  hint: string;
  created_at: string;
  revoked_at?: string;
}

export interface CreatedApiKey extends ApiKeyView {
  /** Returned once at creation; never stored or logged again. */
  token: string;
}

export class ApiKeyValidationError extends Error {
  constructor(message = "invalid label") {
    super(message);
  }
}

export type ApiKeyService = {
  create(ownerId: string, label?: unknown): Promise<CreatedApiKey>;
  list(ownerId: string): Promise<ApiKeyView[]>;
  revoke(ownerId: string, keyId: string): Promise<boolean>;
  ownerIdForToken(token: string): Promise<string | undefined>;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mintToken(): { token: string; hint: string; tokenHash: string } {
  const secret = randomBytes(32).toString("hex");
  const token = `fm_${secret}`;
  return { token, hint: secret.slice(-4), tokenHash: hashToken(token) };
}

function labelsMatch(value: unknown): string {
  if (value === undefined || value === null || value === "") return "default";
  if (typeof value !== "string") throw new ApiKeyValidationError();
  const label = value.trim();
  if (!label || label.length > 64) throw new ApiKeyValidationError();
  return label;
}

export class PostgresApiKeyService {
  constructor(readonly pool: Pool) {}

  async create(ownerId: string, label?: unknown): Promise<CreatedApiKey> {
    const resolved = labelsMatch(label);
    const { token, hint, tokenHash } = mintToken();
    const id = randomUUID();
    const createdAt = new Date();
    await this.pool.query(
      `INSERT INTO "ApiKey" (id, "ownerId", "tokenHash", hint, label, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ownerId, tokenHash, hint, resolved, createdAt]
    );
    return {
      id,
      label: resolved,
      hint,
      created_at: createdAt.toISOString(),
      token
    };
  }

  async list(ownerId: string): Promise<ApiKeyView[]> {
    const result = await this.pool.query<{
      id: string;
      label: string;
      hint: string;
      createdAt: Date;
      revokedAt: Date | null;
    }>(
      `SELECT id, label, hint, "createdAt", "revokedAt"
         FROM "ApiKey"
        WHERE "ownerId" = $1
        ORDER BY "createdAt" DESC`,
      [ownerId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      label: row.label,
      hint: row.hint,
      created_at: row.createdAt.toISOString(),
      ...(row.revokedAt ? { revoked_at: row.revokedAt.toISOString() } : {})
    }));
  }

  async revoke(ownerId: string, keyId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE "ApiKey"
          SET "revokedAt" = NOW()
        WHERE id = $1 AND "ownerId" = $2 AND "revokedAt" IS NULL`,
      [keyId, ownerId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async ownerIdForToken(token: string): Promise<string | undefined> {
    if (!token.startsWith("fm_") || token.length < 12) return undefined;
    const tokenHash = hashToken(token);
    const result = await this.pool.query<{ ownerId: string; tokenHash: string }>(
      `SELECT "ownerId", "tokenHash" FROM "ApiKey"
        WHERE "tokenHash" = $1 AND "revokedAt" IS NULL`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    // Defense in depth: constant-time compare even though lookup used equality.
    const left = Buffer.from(row.tokenHash, "utf8");
    const right = Buffer.from(tokenHash, "utf8");
    if (left.length !== right.length || !timingSafeEqual(left, right)) return undefined;
    return row.ownerId;
  }
}
