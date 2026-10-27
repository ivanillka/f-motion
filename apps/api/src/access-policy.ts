export type AccessMode = "provision_verified" | "invite_only" | "open_beta";

export interface AccessPolicy {
  mode: AccessMode;
  allowedOwnerIds: ReadonlySet<string>;
  /** open_beta only: total User rows allowed before new sign-ups are refused. */
  maxUsers?: number;
}

export class AccountUnavailableError extends Error {
  constructor() {
    super("account unavailable");
  }
}

const supabaseUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const defaultOpenBetaMaxUsers = 50;

function allowlistFromEnv(raw: string): Set<string> {
  const values = raw.split(",").map((value) => value.trim().toLowerCase());
  if (values.some((value) => !value || !supabaseUserId.test(value))) {
    throw new Error("invalid FENGINE_ALLOWED_USER_IDS");
  }
  const allowedOwnerIds = new Set(values);
  if (allowedOwnerIds.size !== values.length) {
    throw new Error("duplicate FENGINE_ALLOWED_USER_IDS");
  }
  return allowedOwnerIds;
}

function openBetaMaxUsersFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.FENGINE_OPEN_BETA_MAX_USERS?.trim();
  if (!raw) return defaultOpenBetaMaxUsers;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 10_000) {
    throw new Error("FENGINE_OPEN_BETA_MAX_USERS must be an integer from 1 to 10000");
  }
  return value;
}

export function accessPolicyFromEnv(
  env: Record<string, string | undefined>
): AccessPolicy {
  const mode = env.FENGINE_ACCESS_MODE || "provision_verified";
  if (mode !== "provision_verified" && mode !== "invite_only" && mode !== "open_beta") {
    throw new Error("invalid FENGINE_ACCESS_MODE");
  }
  if (env.FENGINE_ENV === "hosted" && mode === "provision_verified") {
    throw new Error("hosted requires FENGINE_ACCESS_MODE=invite_only or open_beta");
  }
  if (mode === "provision_verified") {
    return { mode, allowedOwnerIds: new Set() };
  }

  const raw = env.FENGINE_ALLOWED_USER_IDS;
  if (mode === "open_beta") {
    // Open beta: any verified Supabase user may sign up until the seat cap is
    // reached. Allowlisted UUIDs (if any) are always admitted, even when full.
    return {
      mode,
      allowedOwnerIds: raw?.trim() ? allowlistFromEnv(raw) : new Set(),
      maxUsers: openBetaMaxUsersFromEnv(env)
    };
  }
  if (!raw) throw new Error("missing FENGINE_ALLOWED_USER_IDS");
  // ponytail: an env allowlist fits a private demo. Ceiling: operator-managed
  // UUIDs. Upgrade: database-backed invitations when self-service access exists.
  return { mode, allowedOwnerIds: allowlistFromEnv(raw) };
}

export function assertOwnerAdmitted(ownerId: string, policy: AccessPolicy): void {
  if (policy.mode === "invite_only" && !policy.allowedOwnerIds.has(ownerId.toLowerCase())) {
    console.error("invite_only denied", ownerId);
    throw new AccountUnavailableError();
  }
}

interface Queryable {
  query(sql: string, params: unknown[]): Promise<{ rowCount: number | null }>;
}

/**
 * Creates the application User row for a first sign-in. In open_beta a new,
 * non-allowlisted user is only created while the total user count is below
 * the seat cap; otherwise nothing is inserted and the caller's account lookup
 * stays empty, which the auth path turns into a generic 403.
 * Returns true when a row was inserted.
 */
export async function provisionUser(
  db: Queryable,
  ownerId: string,
  policy: AccessPolicy
): Promise<boolean> {
  const capped = policy.mode === "open_beta"
    && policy.maxUsers !== undefined
    && !policy.allowedOwnerIds.has(ownerId.toLowerCase());
  if (!capped) {
    const result = await db.query(
      `INSERT INTO "User" (id, state) VALUES ($1, 'active') ON CONFLICT (id) DO NOTHING`,
      [ownerId]
    );
    return Boolean(result.rowCount);
  }
  // ponytail: count-then-insert in one statement can overshoot the cap by the
  // number of truly concurrent first sign-ins. Ceiling: a handful of seats.
  // Upgrade: an advisory lock or a seats table if the cap must be exact.
  const result = await db.query(
    `INSERT INTO "User" (id, state)
     SELECT $1, 'active'
      WHERE (SELECT count(*) FROM "User") < $2
     ON CONFLICT (id) DO NOTHING`,
    [ownerId, policy.maxUsers]
  );
  if (!result.rowCount) console.error("open_beta full", ownerId);
  return Boolean(result.rowCount);
}
