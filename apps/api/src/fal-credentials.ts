import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  FalProviderError,
  decryptCredential,
  encryptCredential,
  normalizeFalCredential,
  validateFalCredential,
  type CredentialVault,
  type EncryptedCredential
} from "@f-engine/fal-host";

export interface FalCredentialView {
  provider: "fal";
  connected: boolean;
  hint?: string;
  validated_at?: string;
}

export interface FalCredentialService {
  status(ownerId: string): Promise<FalCredentialView>;
  connect(ownerId: string, credential: unknown): Promise<FalCredentialView>;
  test(ownerId: string): Promise<FalCredentialView>;
  disconnect(ownerId: string): Promise<void>;
}

export class FalCredentialInputError extends Error {}
export class FalCredentialMissingError extends Error {}

interface CredentialRow {
  id: string;
  ownerId: string;
  provider: "fal";
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
  hint: string;
  validatedAt: Date | string;
}

function view(row?: Pick<CredentialRow, "hint" | "validatedAt">): FalCredentialView {
  if (!row) return { provider: "fal", connected: false };
  const validated = row.validatedAt instanceof Date ? row.validatedAt : new Date(row.validatedAt);
  return {
    provider: "fal",
    connected: true,
    hint: row.hint,
    validated_at: validated.toISOString()
  };
}

export class PostgresFalCredentialService implements FalCredentialService {
  constructor(
    readonly pool: Pool,
    readonly vault: CredentialVault,
    readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async row(ownerId: string): Promise<CredentialRow | undefined> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt"
         FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'fal'`,
      [ownerId]
    );
    return result.rows[0];
  }

  async status(ownerId: string): Promise<FalCredentialView> {
    return view(await this.row(ownerId));
  }

  async connect(ownerId: string, value: unknown): Promise<FalCredentialView> {
    let credential: string;
    try {
      credential = normalizeFalCredential(value);
    } catch {
      throw new FalCredentialInputError("invalid FAL credential");
    }
    await validateFalCredential(credential, this.fetchImpl);
    const validatedAt = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [ownerId]);
      if (owner.rowCount !== 1) throw new FalCredentialMissingError("account not found");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'fal'`,
        [ownerId]
      );
      const id = existing.rows[0]?.id ?? randomUUID();
      const encrypted = encryptCredential(credential, { id, ownerId, provider: "fal" }, this.vault);
      const hint = credential.slice(-4);
      await client.query(
        `INSERT INTO "ProviderCredential"
           (id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt", "updatedAt")
         VALUES ($1, $2, 'fal', $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT ("ownerId", provider) DO UPDATE SET
           ciphertext = EXCLUDED.ciphertext,
           nonce = EXCLUDED.nonce,
           "authTag" = EXCLUDED."authTag",
           "keyVersion" = EXCLUDED."keyVersion",
           hint = EXCLUDED.hint,
           "validatedAt" = EXCLUDED."validatedAt",
           "updatedAt" = NOW()`,
        [id, ownerId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag,
          encrypted.keyVersion, hint, validatedAt]
      );
      await client.query("COMMIT");
      return view({ hint, validatedAt });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async test(ownerId: string): Promise<FalCredentialView> {
    const row = await this.row(ownerId);
    if (!row) throw new FalCredentialMissingError("FAL is not connected");
    const encrypted: EncryptedCredential = {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      keyVersion: row.keyVersion
    };
    const credential = decryptCredential(encrypted, {
      id: row.id,
      ownerId,
      provider: "fal"
    }, this.vault);
    await validateFalCredential(credential, this.fetchImpl);
    const validatedAt = new Date();
    await this.pool.query(
      `UPDATE "ProviderCredential" SET "validatedAt" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND provider = 'fal'`,
      [validatedAt, row.id, ownerId]
    );
    return view({ hint: row.hint, validatedAt });
  }

  async disconnect(ownerId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'fal'`,
      [ownerId]
    );
  }
}

export function falCredentialHttpError(error: unknown): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof FalCredentialInputError) {
    return { status: 422, body: { type: "validation", message: "Enter a valid FAL API key." } };
  }
  if (error instanceof FalCredentialMissingError) {
    return { status: 409, body: { type: "fal_not_connected", message: "Connect FAL before testing it." } };
  }
  if (error instanceof FalProviderError && error.code === "credential") {
    return { status: 422, body: { type: "invalid_provider_credential", message: "FAL rejected this API key." } };
  }
  if (error instanceof FalProviderError) {
    return { status: 503, body: { type: "provider_unavailable", message: "FAL could not be reached. Try again later." } };
  }
  return undefined;
}
