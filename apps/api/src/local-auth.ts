// Extracted from start.ts so the guard can be unit-tested without booting
// Express/Postgres/S3. See docs/runbooks/local-development.md.
export class LocalAuthForbiddenError extends Error {
  constructor(reason: string) {
    super(`FENGINE_LOCAL_AUTH=1 is forbidden: ${reason}`);
  }
}

export function assertLocalAuthAllowed(env: Record<string, string | undefined>): void {
  if (env.FENGINE_LOCAL_AUTH !== "1") return;
  if (env.NODE_ENV === "production") throw new LocalAuthForbiddenError("NODE_ENV=production");
  if (env.FENGINE_ENV === "hosted") throw new LocalAuthForbiddenError("FENGINE_ENV=hosted");
  if (env.FENGINE_ENV === "corporate" || env.FMOTION_ENV === "corporate") {
    throw new LocalAuthForbiddenError("FENGINE_ENV=corporate");
  }
  if (env.FENGINE_ENV === "selfhost" || env.FMOTION_ENV === "selfhost") {
    throw new LocalAuthForbiddenError("FENGINE_ENV=selfhost");
  }
}
