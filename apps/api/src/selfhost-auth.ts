import { timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "./auth.js";

export function engineEnv(env: Record<string, string | undefined>): string | undefined {
  return env.FENGINE_ENV?.trim() || env.FMOTION_ENV?.trim() || undefined;
}

export function bootstrapTokenFromEnv(env: Record<string, string | undefined>): string | undefined {
  const value = env.FENGINE_BOOTSTRAP_TOKEN?.trim() || env.FMOTION_BOOTSTRAP_TOKEN?.trim();
  return value || undefined;
}

export function assertSelfhostConfig(env: Record<string, string | undefined>): string {
  if (engineEnv(env) !== "selfhost") throw new Error("FENGINE_ENV=selfhost is required");
  if (env.FENGINE_LOCAL_AUTH === "1") {
    throw new Error("FENGINE_LOCAL_AUTH is forbidden when FENGINE_ENV=selfhost");
  }
  const token = bootstrapTokenFromEnv(env);
  if (!token || token.length < 32) throw new Error("missing FENGINE_BOOTSTRAP_TOKEN (min 32 characters)");
  return token;
}

export function assertBootstrapAuthorization(
  authorization: string | undefined,
  expected: string
): void {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  const got = match?.[1] ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedError();
  }
}
