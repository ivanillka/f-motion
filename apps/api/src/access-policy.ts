export type AccessMode = "provision_verified" | "invite_only" | "single_user";

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

function parseAllowedUserIds(raw: string | undefined): Set<string> {
  if (!raw) throw new Error("missing FENGINE_ALLOWED_USER_IDS");
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

export function accessPolicyFromEnv(
  env: Record<string, string | undefined>
): AccessPolicy {
  const mode = env.FENGINE_ACCESS_MODE || "provision_verified";
  if (mode !== "provision_verified" && mode !== "invite_only" && mode !== "single_user") {
    throw new Error("invalid FENGINE_ACCESS_MODE");
  }
  if (env.FENGINE_ENV === "hosted" && mode !== "invite_only") {
    throw new Error("hosted requires FENGINE_ACCESS_MODE=invite_only");
  }
  if (env.FENGINE_ENV === "selfhost" && mode !== "single_user") {
    throw new Error("selfhost requires FENGINE_ACCESS_MODE=single_user");
  }
  if (mode === "provision_verified") {
    return { mode, allowedOwnerIds: new Set() };
  }

  const allowedOwnerIds = parseAllowedUserIds(env.FENGINE_ALLOWED_USER_IDS);
  if (mode === "single_user" && allowedOwnerIds.size !== 1) {
    // Open-source / VPS builds are single-seat. Multi-user is the paid product.
    throw new Error("single_user requires exactly one FENGINE_ALLOWED_USER_IDS entry");
  }
  // ponytail: an env allowlist fits a private demo or single-seat OSS box.
  // Ceiling: operator-managed UUIDs. Upgrade: billed multi-seat invitations.
  return { mode, allowedOwnerIds };
}

export function assertOwnerAdmitted(ownerId: string, policy: AccessPolicy): void {
  if (
    (policy.mode === "invite_only" || policy.mode === "single_user")
    && !policy.allowedOwnerIds.has(ownerId.toLowerCase())
  ) {
    console.error(`${policy.mode} denied`, ownerId);
    throw new AccountUnavailableError();
  }
}
