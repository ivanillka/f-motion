import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const falPricingUrl = "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fflux%2Fschnell";
const falEndpointId = "fal-ai/flux/schnell";

export interface CredentialVault {
  activeVersion: number;
  keys: ReadonlyMap<number, Uint8Array>;
}

export interface EncryptedCredential {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  keyVersion: number;
}

export interface CredentialIdentity {
  id: string;
  ownerId: string;
  provider: "fal" | "pexels";
}

export class FalProviderError extends Error {
  readonly name = "FalProviderError";

  constructor(readonly code: "credential" | "unavailable") {
    super(code === "credential" ? "provider credential rejected" : "provider unavailable");
  }
}

function positiveVersion(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid credential key version");
  return value;
}

function decodeKey(value: string | undefined): Uint8Array {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("invalid credential encryption key");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error("invalid credential encryption key");
  }
  return decoded;
}

export function falByokEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.FENGINE_FAL_BYOK_ENABLED;
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("invalid FENGINE_FAL_BYOK_ENABLED");
  return true;
}

export function credentialVaultFromEnv(env: Record<string, string | undefined>): CredentialVault {
  const activeVersion = positiveVersion(env.FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION);
  const key = decodeKey(env[`FENGINE_CREDENTIAL_KEY_V${activeVersion}`]);
  return { activeVersion, keys: new Map([[activeVersion, key]]) };
}

export function assertNoSharedFalCredential(env: Record<string, string | undefined>): void {
  if ((env.FENGINE_ENV === "hosted" || env.NODE_ENV === "production")
    && (env.FAL_KEY !== undefined || env.FAL_API_KEY !== undefined)) {
    throw new Error("shared FAL credentials are forbidden in hosted mode");
  }
}

export function assertNoSharedPexelsCredential(env: Record<string, string | undefined>): void {
  if ((env.FENGINE_ENV === "hosted" || env.NODE_ENV === "production")
    && env.PEXELS_API_KEY !== undefined) {
    throw new Error("shared Pexels credentials are forbidden in hosted mode");
  }
}

function aad(identity: CredentialIdentity, keyVersion: number): Buffer {
  return Buffer.from(`${identity.id}\n${identity.ownerId}\n${identity.provider}\n${keyVersion}`, "utf8");
}

export function encryptCredential(
  plaintext: string,
  identity: CredentialIdentity,
  vault: CredentialVault
): EncryptedCredential {
  const key = vault.keys.get(vault.activeVersion);
  if (!key) throw new Error("credential encryption key unavailable");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(identity, vault.activeVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion: vault.activeVersion
  };
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  identity: CredentialIdentity,
  vault: CredentialVault
): string {
  const key = vault.keys.get(encrypted.keyVersion);
  if (!key) throw new Error("credential encryption key unavailable");
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAAD(aad(identity, encrypted.keyVersion));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
}

export function normalizeProviderCredential(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid provider credential");
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("invalid provider credential");
  }
  return normalized;
}

export function normalizeFalCredential(value: unknown): string {
  return normalizeProviderCredential(value);
}

function validPricing(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prices = (value as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) return false;
  return prices.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const price = item as Record<string, unknown>;
    return price.endpoint_id === falEndpointId
      && typeof price.unit_price === "number"
      && Number.isFinite(price.unit_price)
      && price.unit_price >= 0
      && typeof price.unit === "string"
      && typeof price.currency === "string";
  });
}

export async function validateFalCredential(
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
      response = await fetchImpl(falPricingUrl, {
        headers: { authorization: `Key ${credential}`, accept: "application/json" },
        signal: controller.signal
      });
    } catch {
      throw new FalProviderError("unavailable");
    }
    if (response.status === 401 || response.status === 403) throw new FalProviderError("credential");
    if (!response.ok) throw new FalProviderError("unavailable");
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new FalProviderError("unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new FalProviderError("unavailable");
    }
    if (!validPricing(body)) throw new FalProviderError("unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
