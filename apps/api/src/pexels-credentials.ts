import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  decryptCredential,
  encryptCredential,
  normalizeProviderCredential,
  type CredentialVault,
  type EncryptedCredential
} from "@f-engine/fal-host";
import { PexelsClient } from "./media-storage.js";

const validationUrl = "https://api.pexels.com/v1/videos/search?query=cinematic&orientation=portrait&per_page=1";

export interface PexelsCredentialView {
  provider: "pexels";
  connected: boolean;
  hint?: string;
  validated_at?: string;
}

export interface PexelsCredentialService {
  status(ownerId: string): Promise<PexelsCredentialView>;
  connect(ownerId: string, credential: unknown): Promise<PexelsCredentialView>;
  test(ownerId: string): Promise<PexelsCredentialView>;
  disconnect(ownerId: string): Promise<void>;
  client(ownerId: string): Promise<PexelsClient>;
}

export class PexelsCredentialInputError extends Error {}
export class PexelsCredentialMissingError extends Error {}
export class PexelsProviderError extends Error {
  readonly name = "PexelsProviderError";
  constructor(readonly code: "credential" | "unavailable") {
    super(code === "credential" ? "provider credential rejected" : "provider unavailable");
  }
}

interface CredentialRow {
  id: string;
  ownerId: string;
  provider: "pexels";
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
  hint: string;
  validatedAt: Date | string;
}

function view(row?: Pick<CredentialRow, "hint" | "validatedAt">): PexelsCredentialView {
  if (!row) return { provider: "pexels", connected: false };
  const validated = row.validatedAt instanceof Date ? row.validatedAt : new Date(row.validatedAt);
  return { provider: "pexels", connected: true, hint: row.hint, validated_at: validated.toISOString() };
}

export function pexelsByokEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.FENGINE_PEXELS_BYOK_ENABLED;
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("invalid FENGINE_PEXELS_BYOK_ENABLED");
  return true;
}

export async function validatePexelsCredential(
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
        headers: { authorization: credential, accept: "application/json" },
        signal: controller.signal
      });
    } catch {
      throw new PexelsProviderError("unavailable");
    }
    if (response.status === 401 || response.status === 403) throw new PexelsProviderError("credential");
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new PexelsProviderError("unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PexelsProviderError("unavailable");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || !Array.isArray((body as { videos?: unknown }).videos)) {
      throw new PexelsProviderError("unavailable");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export class PostgresPexelsCredentialService implements PexelsCredentialService {
  constructor(
    readonly pool: Pool,
    readonly vault: CredentialVault,
    readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async row(ownerId: string): Promise<CredentialRow | undefined> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt"
         FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'pexels'`,
      [ownerId]
    );
    return result.rows[0];
  }

  async status(ownerId: string): Promise<PexelsCredentialView> {
    return view(await this.row(ownerId));
  }

  async connect(ownerId: string, value: unknown): Promise<PexelsCredentialView> {
    let credential: string;
    try {
      credential = normalizeProviderCredential(value);
    } catch {
      throw new PexelsCredentialInputError("invalid Pexels credential");
    }
    await validatePexelsCredential(credential, this.fetchImpl);
    const validatedAt = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [ownerId]);
      if (owner.rowCount !== 1) throw new PexelsCredentialMissingError("account not found");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'pexels'`,
        [ownerId]
      );
      const id = existing.rows[0]?.id ?? randomUUID();
      const encrypted = encryptCredential(credential, { id, ownerId, provider: "pexels" }, this.vault);
      const hint = credential.slice(-4);
      await client.query(
        `INSERT INTO "ProviderCredential"
           (id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt", "updatedAt")
         VALUES ($1, $2, 'pexels', $3, $4, $5, $6, $7, $8, NOW())
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
    return decryptCredential(encrypted, { id: row.id, ownerId, provider: "pexels" }, this.vault);
  }

  async client(ownerId: string): Promise<PexelsClient> {
    const row = await this.row(ownerId);
    if (!row) throw new PexelsCredentialMissingError("Pexels is not connected");
    return new PexelsClient(this.decrypt(row, ownerId), this.fetchImpl);
  }

  async test(ownerId: string): Promise<PexelsCredentialView> {
    const row = await this.row(ownerId);
    if (!row) throw new PexelsCredentialMissingError("Pexels is not connected");
    await validatePexelsCredential(this.decrypt(row, ownerId), this.fetchImpl);
    const validatedAt = new Date();
    await this.pool.query(
      `UPDATE "ProviderCredential" SET "validatedAt" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND provider = 'pexels'`,
      [validatedAt, row.id, ownerId]
    );
    return view({ hint: row.hint, validatedAt });
  }

  async disconnect(ownerId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'pexels'`,
      [ownerId]
    );
  }
}

export function pexelsCredentialHttpError(error: unknown): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof PexelsCredentialInputError) {
    return { status: 422, body: { type: "validation", message: "Enter a valid Pexels API key." } };
  }
  if (error instanceof PexelsCredentialMissingError) {
    return { status: 409, body: { type: "pexels_not_connected", message: "Connect your Pexels API key in Settings." } };
  }
  if (error instanceof PexelsProviderError && error.code === "credential") {
    return { status: 422, body: { type: "invalid_provider_credential", message: "Pexels rejected this API key." } };
  }
  if (error instanceof PexelsProviderError) {
    return { status: 503, body: { type: "provider_unavailable", message: "Pexels could not be reached. Try again later." } };
  }
  return undefined;
}
