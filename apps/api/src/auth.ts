import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  AccountUnavailableError,
  assertOwnerAdmitted,
  type AccessPolicy
} from "./access-policy.js";

export { AccountUnavailableError } from "./access-policy.js";

export interface AuthConfig { issuer: string; audience: string; jwksUrl: URL }
export type AccountStateLookup = (ownerId: string) => Promise<string | undefined>;
export type EnsureUser = (ownerId: string) => Promise<void>;
export type ApiKeyLookup = (token: string) => Promise<string | undefined>;

export class UnauthorizedError extends Error {
  constructor() { super("authentication required"); }
}

export async function verifyAccessToken(token: string, config: AuthConfig): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, createRemoteJWKSet(config.jwksUrl), {
    issuer: config.issuer,
    audience: config.audience
  });
  if (!payload.sub) throw new Error("token has no subject");
  return payload;
}

export function assertAccountActive(state: string): void {
  if (state !== "active") throw new AccountUnavailableError();
}

function looksLikeApiKey(token: string): boolean {
  return token.startsWith("fm_") && token.length > 10;
}

export async function authenticateBearer(
  authorization: string | undefined,
  config: AuthConfig,
  accountState: AccountStateLookup,
  ensureUser?: EnsureUser,
  accessPolicy: AccessPolicy = { mode: "provision_verified", allowedOwnerIds: new Set() },
  apiKeyLookup?: ApiKeyLookup
): Promise<string> {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) throw new UnauthorizedError();
  const token = match[1];

  if (apiKeyLookup && looksLikeApiKey(token)) {
    const ownerId = await apiKeyLookup(token);
    if (!ownerId) throw new UnauthorizedError();
    assertOwnerAdmitted(ownerId, accessPolicy);
    // API keys never auto-provision; the owner account must already exist.
    const state = await accountState(ownerId);
    assertAccountActive(state ?? "missing");
    return ownerId;
  }

  let payload: JWTPayload;
  try {
    payload = await verifyAccessToken(token, config);
  } catch {
    throw new UnauthorizedError();
  }

  const ownerId = payload.sub;
  if (!ownerId) throw new UnauthorizedError();
  assertOwnerAdmitted(ownerId, accessPolicy);
  let state = await accountState(ownerId);
  if (state === undefined && ensureUser) {
    await ensureUser(ownerId);
    state = await accountState(ownerId);
  }
  assertAccountActive(state ?? "missing");
  return ownerId;
}
