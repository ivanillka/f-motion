import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  decryptCredential,
  encryptCredential,
  normalizeProviderCredential,
  type CredentialVault,
  type EncryptedCredential
} from "@f-engine/fal-host";
import { PixabayClient } from "./media-storage.js";

const validationQuery = "cinematic";

export interface PixabayCredentialView {
  provider: "pixabay";
  connected: boolean;
  hint?: string;
  validated_at?: string;
}

export interface PixabayCredentialService {
  status(ownerId: string): Promise<PixabayCredentialView>;
  connect(ownerId: string, credential: unknown): Promise<PixabayCredentialView>;
  test(ownerId: string): Promise<PixabayCredentialView>;
  disconnect(ownerId: string): Promise<void>;
  client(ownerId: string): Promise<PixabayClient>;
}

export class PixabayCredentialInputError extends Error {}
export class PixabayCredentialMissingError extends Error {}
export class PixabayProviderError extends Error {
  readonly name = "PixabayProviderError";
  constructor(readonly code: "credential" | "unavailable") {
    super(code === "credential" ? "provider credential rejected" : "provider unavailable");
  }
}

interface CredentialRow {
  id: string;
  ownerId: string;
  provider: "pixabay";
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
  hint: string;
  validatedAt: Date | string;
}

function view(row?: Pick<CredentialRow, "hint" | "validatedAt">): PixabayCredentialView {
  if (!row) return { provider: "pixabay", connected: false };
  const validated = row.validatedAt instanceof Date ? row.validatedAt : new Date(row.validatedAt);
  return { provider: "pixabay", connected: true, hint: row.hint, validated_at: validated.toISOString() };
}

export function pixabayByokEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.FENGINE_PIXABAY_BYOK_ENABLED;
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("invalid FENGINE_PIXABAY_BYOK_ENABLED");
  return true;
}

export async function validatePixabayCredential(
  credential: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  const url = `https://pixabay.com/api/videos/?key=${encodeURIComponent(credential)}&q=${validationQuery}&per_page=3`;
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
    } catch {
      throw new PixabayProviderError("unavailable");
    }
    if (response.status === 401 || response.status === 403) throw new PixabayProviderError("credential");
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new PixabayProviderError("unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PixabayProviderError("unavailable");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || !Array.isArray((body as { hits?: unknown }).hits)) {
      throw new PixabayProviderError("unavailable");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export class PostgresPixabayCredentialService implements PixabayCredentialService {
  constructor(
    readonly pool: Pool,
    readonly vault: CredentialVault,
    readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async row(ownerId: string): Promise<CredentialRow | undefined> {
    const result = await this.pool.query<CredentialRow>(
      `SELECT id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt"
         FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'pixabay'`,
      [ownerId]
    );
    return result.rows[0];
  }

  async status(ownerId: string): Promise<PixabayCredentialView> {
    return view(await this.row(ownerId));
  }

  async connect(ownerId: string, value: unknown): Promise<PixabayCredentialView> {
    let credential: string;
    try {
      credential = normalizeProviderCredential(value);
    } catch {
      throw new PixabayCredentialInputError("invalid Pixabay credential");
    }
    await validatePixabayCredential(credential, this.fetchImpl);
    const validatedAt = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const owner = await client.query(`SELECT id FROM "User" WHERE id = $1 FOR UPDATE`, [ownerId]);
      if (owner.rowCount !== 1) throw new PixabayCredentialMissingError("account not found");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'pixabay'`,
        [ownerId]
      );
      const id = existing.rows[0]?.id ?? randomUUID();
      const encrypted = encryptCredential(credential, { id, ownerId, provider: "pixabay" }, this.vault);
      const hint = credential.slice(-4);
      await client.query(
        `INSERT INTO "ProviderCredential"
           (id, "ownerId", provider, ciphertext, nonce, "authTag", "keyVersion", hint, "validatedAt", "updatedAt")
         VALUES ($1, $2, 'pixabay', $3, $4, $5, $6, $7, $8, NOW())
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
    return decryptCredential(encrypted, { id: row.id, ownerId, provider: "pixabay" }, this.vault);
  }

  async client(ownerId: string): Promise<PixabayClient> {
    const row = await this.row(ownerId);
    if (!row) throw new PixabayCredentialMissingError("Pixabay is not connected");
    return new PixabayClient(this.decrypt(row, ownerId), this.fetchImpl);
  }

  async test(ownerId: string): Promise<PixabayCredentialView> {
    const row = await this.row(ownerId);
    if (!row) throw new PixabayCredentialMissingError("Pixabay is not connected");
    await validatePixabayCredential(this.decrypt(row, ownerId), this.fetchImpl);
    const validatedAt = new Date();
    await this.pool.query(
      `UPDATE "ProviderCredential" SET "validatedAt" = $1, "updatedAt" = NOW()
        WHERE id = $2 AND "ownerId" = $3 AND provider = 'pixabay'`,
      [validatedAt, row.id, ownerId]
    );
    return view({ hint: row.hint, validatedAt });
  }

  async disconnect(ownerId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'pixabay'`,
      [ownerId]
    );
  }
}

export function pixabayCredentialHttpError(error: unknown): { status: number; body: { type: string; message: string } } | undefined {
  if (error instanceof PixabayCredentialInputError) {
    return { status: 422, body: { type: "validation", message: "Enter a valid Pixabay API key." } };
  }
  if (error instanceof PixabayCredentialMissingError) {
    return { status: 409, body: { type: "pixabay_not_connected", message: "Connect your Pixabay API key in Settings." } };
  }
  if (error instanceof PixabayProviderError && error.code === "credential") {
    return { status: 422, body: { type: "invalid_provider_credential", message: "Pixabay rejected this API key." } };
  }
  if (error instanceof PixabayProviderError) {
    return { status: 503, body: { type: "provider_unavailable", message: "Pixabay could not be reached. Try again later." } };
  }
  return undefined;
}
