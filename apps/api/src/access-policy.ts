export type AccessMode = "provision_verified" | "invite_only";

export interface AccessPolicy {
  mode: AccessMode;
  allowedOwnerIds: ReadonlySet<string>;
}

export class AccountUnavailableError extends Error {
  constructor() {
    super("account unavailable");
  }
}

const supabaseUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function accessPolicyFromEnv(
  env: Record<string, string | undefined>
): AccessPolicy {
  const mode = env.FENGINE_ACCESS_MODE || "provision_verified";
  if (mode !== "provision_verified" && mode !== "invite_only") {
    throw new Error("invalid FENGINE_ACCESS_MODE");
  }
  if (mode === "provision_verified") {
    return { mode, allowedOwnerIds: new Set() };
  }

  const raw = env.FENGINE_ALLOWED_USER_IDS;
  if (!raw) throw new Error("missing FENGINE_ALLOWED_USER_IDS");
  const values = raw.split(",").map((value) => value.trim().toLowerCase());
  if (values.some((value) => !value || !supabaseUserId.test(value))) {
    throw new Error("invalid FENGINE_ALLOWED_USER_IDS");
  }
  const allowedOwnerIds = new Set(values);
  if (allowedOwnerIds.size !== values.length) {
    throw new Error("duplicate FENGINE_ALLOWED_USER_IDS");
  }
  // ponytail: an env allowlist fits a private demo. Ceiling: operator-managed
  // UUIDs. Upgrade: database-backed invitations when self-service access exists.
  return { mode, allowedOwnerIds };
}

export function assertOwnerAdmitted(ownerId: string, policy: AccessPolicy): void {
  if (policy.mode === "invite_only" && !policy.allowedOwnerIds.has(ownerId.toLowerCase())) {
    throw new AccountUnavailableError();
  }
}
