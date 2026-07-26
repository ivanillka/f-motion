import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthConfig { issuer: string; audience: string; jwksUrl: URL }

export async function verifyAccessToken(token: string, config: AuthConfig): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, createRemoteJWKSet(config.jwksUrl), {
    issuer: config.issuer,
    audience: config.audience
  });
  if (!payload.sub) throw new Error("token has no subject");
  return payload;
}

export function assertAccountActive(state: string): void {
  if (state !== "active") throw new Error("account unavailable");
}
