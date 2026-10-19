import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  decryptCredential,
  encryptCredential,
  normalizeProviderCredential,
  type CredentialVault,
  type EncryptedCredential
} from "@f-engine/fal-host";
import { CivitaiClient, civitaiLevelRank, type CivitaiPolicy } from "./civitai.js";

const validationUrl = "https://civitai.com/api/v1/me";

export interface CivitaiCredentialView {
  provider: "civitai";
  connected: boolean;
  hint?: string;
  validated_at?: string;
}

export interface CivitaiCredentialService {
  status(ownerId: string): Promise<CivitaiCredentialView>;
  connect(ownerId: string, credential: unknown): Promise<CivitaiCredentialView>;
  test(ownerId: string): Promise<CivitaiCredentialView>;
  disconnect(ownerId: string): Promise<void>;
  client(ownerId: string, policy?: CivitaiPolicy): Promise<CivitaiClient>;
  optionalClient(ownerId: string, policy?: CivitaiPolicy): Promise<CivitaiClient>;
}

export class CivitaiCredentialInputError extends Error {}
export class CivitaiCredentialMissingError extends Error {}
export class CivitaiProviderError extends Error {
  readonly name = "CivitaiProviderError";
  constructor(readonly code: "credential" | "unavailable") {
    super(code === "credential" ? "provider credential rejected" : "provider unavailable");
  }
}

interface CredentialRow {
  id: string;
  ownerId: string;
  provider: "civitai";
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
  hint: string;
  validatedAt: Date | string;
}

function view(row?: Pick<CredentialRow, "hint" | "validatedAt">): CivitaiCredentialView {
  if (!row) return { provider: "civitai", connected: false };
  const validated = row.validatedAt instanceof Date ? row.validatedAt : new Date(row.validatedAt);
  return { provider: "civitai", connected: true, hint: row.hint, validated_at: validated.toISOString() };
}

export function civitaiByokEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.FENGINE_CIVITAI_BYOK_ENABLED;
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("invalid FENGINE_CIVITAI_BYOK_ENABLED");
  return true;
}

export async function validateCivitaiCredential(
  credential: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    let response: Response;
    try {
      response = await fetchImpl(validationUrl, {
        headers: { authorization: `Bearer ${credential}`, accept: "application/json" },
        signal: controller.signal
      });
    } catch {
      throw new CivitaiProviderError("unavailable");
    }
    if (response.status === 401 || response.status === 403) throw new CivitaiProviderError("credential");
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new CivitaiProviderError("unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new CivitaiProviderError("unavailable");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CivitaiProviderError("unavailable");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export class PostgresCivitaiCredentialService implements CivitaiCredentialService {
  constructor(
    readonly pool: Pool,
    readonly vault: CredentialVault,
    readonly policy: CivitaiPolicy,
    readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async row(ownerId: string): Promise<CredentialRow | undefined> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt"
         FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'civitai'`,
      [ownerId]
    );
    return result.rows[0];
  }

  async status(ownerId: string): Promise<CivitaiCredentialView> {
    return view(await this.row(ownerId));
  }

  async connect(ownerId: string, value: unknown): Promise<CivitaiCredentialView> {
    let credential: string;
    try {
      credential = normalizeProviderCredential(value);
    } catch {
      throw new CivitaiCredentialInputError("invalid Civitai credential");
    }
    await validateCivitaiCredential(credential, this.fetchImpl);
    const validatedAt = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [ownerId]);
      if (owner.rowCount !== 1) throw new CivitaiCredentialMissingError("account not found");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'civitai'`,
        [ownerId]
      );
      const id = existing.rows[0]?.id ?? randomUUID();
      const encrypted = encryptCredential(credential, { id, ownerId, provider: "civitai" }, this.vault);
      const hint = credential.slice(-4);
      await client.query(
        `INSERT INTO "ProviderCredential"
           (id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt", "updatedAt")
         VALUES ($1, $2, 'civitai', $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT ("ownerId", provider) DO UPDATE SET
           ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce,
           "authTag" = EXCLUDED."authTag", "keyVersion" = EXCLUDED."keyVersion",
           hint = EXCLUDED.hint, "validatedAt" = EXCLUDED."validatedAt", "updatedAt" = NOW()`,
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

  private decrypt(row: CredentialRow, ownerId: string): string {
    const encrypted: EncryptedCredential = {
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      keyVersion: row.keyVersion
    };
    return decryptCredential(encrypted, { id: row.id, ownerId, provider: "civitai" }, this.vault);
  }

  async client(ownerId: string, policy: CivitaiPolicy = this.policy): Promise<CivitaiClient> {
    const row = await this.row(ownerId);
    if (!row) throw new CivitaiCredentialMissingError("Civitai is not connected");
    return new CivitaiClient(this.decrypt(row, ownerId), policy, this.fetchImpl);
  }

  async optionalClient(ownerId: string, policy: CivitaiPolicy = this.policy): Promise<CivitaiClient> {
    const row = await this.row(ownerId);
    if (!row && civitaiLevelRank(policy.nsfwLevel) > civitaiLevelRank("Soft")) {
      throw new CivitaiCredentialMissingError("Civitai API key is required for this NSFW level");
    }
    return new CivitaiClient(row ? this.decrypt(row, ownerId) : undefined, policy, this.fetchImpl);
  }

  async test(ownerId: string): Promise<CivitaiCredentialView> {
    const row = await this.row(ownerId);
    if (!row) throw new CivitaiCredentialMissingError("Civitai is not connected");
    await validateCivitaiCredential(this.decrypt(row, ownerId), this.fetchImpl);
    const validatedAt = new Date();
    await this.pool.query(
      `UPDATE "ProviderCredential" SET "validatedAt" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND provider = 'civitai'`,
      [validatedAt, row.id, ownerId]
    );
    return view({ hint: row.hint, validatedAt });
  }

  async disconnect(ownerId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'civitai'`,
      [ownerId]
    );
  }
}

export function civitaiCredentialHttpError(error: unknown): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof CivitaiCredentialInputError) {
    return { status: 422, body: { type: "validation", message: "Enter a valid Civitai API key." } };
  }
  if (error instanceof CivitaiCredentialMissingError) {
    return { status: 409, body: { type: "civitai_not_connected", message: "Connect your Civitai API key in Settings." } };
  }
  if (error instanceof CivitaiProviderError && error.code === "credential") {
    return { status: 422, body: { type: "invalid_provider_credential", message: "Civitai rejected this API key." } };
  }
  if (error instanceof CivitaiProviderError) {
    return { status: 503, body: { type: "provider_unavailable", message: "Civitai could not be reached. Try again later." } };
  }
  return undefined;
}
