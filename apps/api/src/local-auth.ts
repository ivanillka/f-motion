// Extracted from start.ts so the guard can be unit-tested without booting
// Express/Postgres/S3. See docs/runbooks/local-development.md.
export class LocalAuthForbiddenError extends Error {
  constructor(reason: string) {
    super(`FMOTION_LOCAL_AUTH=1 is forbidden: ${reason}`);
  }
}

export function assertLocalAuthAllowed(env: Record<string, string | undefined>): void {
  if (env.FMOTION_LOCAL_AUTH !== "1") return;
  if (env.NODE_ENV === "production") throw new LocalAuthForbiddenError("NODE_ENV=production");
  if (env.FMOTION_ENV === "hosted") throw new LocalAuthForbiddenError("FMOTION_ENV=hosted");
}
