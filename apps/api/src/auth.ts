import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthConfig { issuer: string; audience: string; jwksUrl: URL }
export type AccountStateLookup = (ownerId: string) => Promise<string | undefined>;
export type EnsureUser = (ownerId: string) => Promise<void>;

export class UnauthorizedError extends Error {
  constructor() { super("authentication required"); }
}

export class AccountUnavailableError extends Error {
  constructor() { super("account unavailable"); }
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

export async function authenticateBearer(
  authorization: string | undefined,
  config: AuthConfig,
  accountState: AccountStateLookup,
  ensureUser?: EnsureUser
): Promise<string> {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) throw new UnauthorizedError();

  let payload: JWTPayload;
  try {
    payload = await verifyAccessToken(match[1], config);
  } catch {
    throw new UnauthorizedError();
  }

  const ownerId = payload.sub;
  if (!ownerId) throw new UnauthorizedError();
  let state = await accountState(ownerId);
  if (state === undefined && ensureUser) {
    await ensureUser(ownerId);
    state = await accountState(ownerId);
  }
  assertAccountActive(state ?? "missing");
  return ownerId;
}
