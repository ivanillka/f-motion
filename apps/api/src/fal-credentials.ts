import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  FalProviderError,
  decryptCredential,
  encryptCredential,
  fetchAccount,
  normalizeFalCredential,
  validateFalCredential,
  type CredentialVault,
  type EncryptedCredential,
  type FalAccountView
} from "@f-engine/fal-host";

export interface FalCredentialView {
  provider: "fal";
  connected: boolean;
  hint?: string;
  validated_at?: string;
  account?: FalAccountView;
}

export interface FalCredentialService {
  status(ownerId: string): Promise<FalCredentialView>;
  connect(ownerId: string, credential: unknown): Promise<FalCredentialView>;
  test(ownerId: string): Promise<FalCredentialView>;
  disconnect(ownerId: string): Promise<void>;
  decryptForOwner(ownerId: string): Promise<{ id: string; apiKey: string }>;
}

export class FalCredentialInputError extends Error {}
export class FalCredentialMissingError extends Error {}
export class FalCredentialBusyError extends Error {}

const ACTIVE_GENERATION_STATES = ["queued", "submitting", "running", "downloading", "inspecting"] as const;

export async function assertNoActiveFalGeneration(client: Pool | PoolClient, ownerId: string): Promise<void> {
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM "GenerationJob"
      WHERE "ownerId" = $1
        AND (
          state::text = ANY($2::text[])
          OR ("cancelRequested" = TRUE AND state NOT IN ('ready', 'cancelled', 'failed', 'submission_uncertain'))
        )`,
    [ownerId, [...ACTIVE_GENERATION_STATES]]
  );
  if ((result.rows[0]?.count ?? 0) > 0) throw new FalCredentialBusyError("active FAL generation");
}

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

function view(row?: Pick<CredentialRow, "hint" | "validatedAt">, account?: FalAccountView): FalCredentialView {
  if (!row) return { provider: "fal", connected: false };
  const validated = row.validatedAt instanceof Date ? row.validatedAt : new Date(row.validatedAt);
  return {
    provider: "fal",
    connected: true,
    hint: row.hint,
    validated_at: validated.toISOString(),
    ...(account ? { account } : {})
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
    const row = await this.row(ownerId);
    if (!row) return view();
    try {
      const apiKey = decryptCredential({
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        authTag: row.authTag,
        keyVersion: row.keyVersion
      }, { id: row.id, ownerId, provider: "fal" }, this.vault);
      return view(row, await fetchAccount(apiKey, this.fetchImpl));
    } catch {
      return view(row, { credits_unavailable: "provider_unavailable" });
    }
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
      await assertNoActiveFalGeneration(client, ownerId);
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
      await client.query(
        `UPDATE "GenerationJob" SET state = 'failed', "failureCode" = 'credential_changed', "updatedAt" = NOW()
          WHERE "ownerId" = $1 AND state = 'quoted'`,
        [ownerId]
      );
      await client.query("COMMIT");
      return view({ hint, validatedAt }, await fetchAccount(credential, this.fetchImpl));
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof FalCredentialBusyError) throw error;
      throw error;
    } finally {
      client.release();
    }
  }

  async decryptForOwner(ownerId: string): Promise<{ id: string; apiKey: string }> {
    const row = await this.row(ownerId);
    if (!row) throw new FalCredentialMissingError("FAL is not connected");
    const encrypted: EncryptedCredential = {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      keyVersion: row.keyVersion
    };
    return {
      id: row.id,
      apiKey: decryptCredential(encrypted, { id: row.id, ownerId, provider: "fal" }, this.vault)
    };
  }

  async test(ownerId: string): Promise<FalCredentialView> {
    const { id, apiKey } = await this.decryptForOwner(ownerId);
    await validateFalCredential(apiKey, this.fetchImpl);
    const validatedAt = new Date();
    const row = await this.row(ownerId);
    await this.pool.query(
      `UPDATE "ProviderCredential" SET "validatedAt" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND provider = 'fal'`,
      [validatedAt, id, ownerId]
    );
    return view({ hint: row?.hint ?? apiKey.slice(-4), validatedAt }, await fetchAccount(apiKey, this.fetchImpl));
  }

  async disconnect(ownerId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await assertNoActiveFalGeneration(client, ownerId);
      await client.query(
        `DELETE FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'fal'`,
        [ownerId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof FalCredentialBusyError) throw error;
      throw error;
    } finally {
      client.release();
    }
  }
}

export function falCredentialHttpError(error: unknown): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof FalCredentialInputError) {
    return { status: 422, body: { type: "validation", message: "Enter a valid FAL API key." } };
  }
  if (error instanceof FalCredentialMissingError) {
    return { status: 409, body: { type: "fal_not_connected", message: "Connect FAL before testing it." } };
  }
  if (error instanceof FalCredentialBusyError) {
    return {
      status: 409,
      body: {
        type: "fal_credential_busy",
        message: "Cancel or wait for the active FAL job before changing credentials."
      }
    };
  }
  if (error instanceof FalProviderError && error.code === "credential") {
    return { status: 422, body: { type: "invalid_provider_credential", message: "FAL rejected this API key." } };
  }
  if (error instanceof FalProviderError) {
    return { status: 503, body: { type: "provider_unavailable", message: "FAL could not be reached. Try again later." } };
  }
  return undefined;
}
