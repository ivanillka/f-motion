import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountUnavailableError,
  accessPolicyFromEnv,
  assertOwnerAdmitted,
  provisionUser
} from "../dist/access-policy.js";

const invited = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";

test("verified provisioning remains the local compatibility default", () => {
  const policy = accessPolicyFromEnv({});
  assert.equal(policy.mode, "provision_verified");
  assert.doesNotThrow(() => assertOwnerAdmitted("any-subject", policy));
});

test("hosted access requires an explicit invite-only or open-beta mode", () => {
  assert.throws(
    () => accessPolicyFromEnv({ FENGINE_ENV: "hosted" }),
    /hosted requires FENGINE_ACCESS_MODE=invite_only or open_beta/
  );
  assert.throws(
    () => accessPolicyFromEnv({
      FENGINE_ENV: "hosted",
      FENGINE_ACCESS_MODE: "provision_verified"
    }),
    /hosted requires FENGINE_ACCESS_MODE=invite_only or open_beta/
  );
});

test("hosted invite-only mode requires a valid non-empty allowlist", () => {
  assert.throws(
    () => accessPolicyFromEnv({
      FENGINE_ENV: "hosted",
      FENGINE_ACCESS_MODE: "invite_only"
    }),
    /missing FENGINE_ALLOWED_USER_IDS/
  );
});

test("hosted invite-only admits exact configured Supabase subjects", () => {
  const policy = accessPolicyFromEnv({
    FENGINE_ENV: "hosted",
    FENGINE_ACCESS_MODE: "invite_only",
    FENGINE_ALLOWED_USER_IDS: invited
  });
  assert.doesNotThrow(() => assertOwnerAdmitted(invited, policy));
  assert.throws(
    () => assertOwnerAdmitted(second, policy),
    AccountUnavailableError
  );
});

test("invite list trims whitespace and normalizes UUID case", () => {
  const policy = accessPolicyFromEnv({
    FENGINE_ACCESS_MODE: "invite_only",
    FENGINE_ALLOWED_USER_IDS: ` ${invited.toUpperCase()} , ${second} `
  });
  assert.deepEqual([...policy.allowedOwnerIds], [invited, second]);
});

test("invite-only rejects missing and empty entries", () => {
  assert.throws(
    () => accessPolicyFromEnv({ FENGINE_ACCESS_MODE: "invite_only" }),
    /missing FENGINE_ALLOWED_USER_IDS/
  );
  assert.throws(
    () => accessPolicyFromEnv({
      FENGINE_ACCESS_MODE: "invite_only",
      FENGINE_ALLOWED_USER_IDS: `${invited},`
    }),
    /invalid FENGINE_ALLOWED_USER_IDS/
  );
});

test("invite-only rejects duplicates", () => {
  assert.throws(
    () => accessPolicyFromEnv({
      FENGINE_ACCESS_MODE: "invite_only",
      FENGINE_ALLOWED_USER_IDS: `${invited},${invited.toUpperCase()}`
    }),
    /duplicate FENGINE_ALLOWED_USER_IDS/
  );
});

test("invite-only rejects malformed IDs", () => {
  assert.throws(
    () => accessPolicyFromEnv({
      FENGINE_ACCESS_MODE: "invite_only",
      FENGINE_ALLOWED_USER_IDS: "not-a-uuid"
    }),
    /invalid FENGINE_ALLOWED_USER_IDS/
  );
});

test("unknown access modes fail startup", () => {
  assert.throws(
    () => accessPolicyFromEnv({ FENGINE_ACCESS_MODE: "public" }),
    /invalid FENGINE_ACCESS_MODE/
  );
});

test("open beta needs no allowlist and defaults to a 50 seat cap", () => {
  const policy = accessPolicyFromEnv({ FENGINE_ENV: "hosted", FENGINE_ACCESS_MODE: "open_beta" });
  assert.equal(policy.mode, "open_beta");
  assert.equal(policy.maxUsers, 50);
  assert.doesNotThrow(() => assertOwnerAdmitted(second, policy));
});

test("open beta validates the seat cap and an optional allowlist", () => {
  const policy = accessPolicyFromEnv({
    FENGINE_ENV: "hosted",
    FENGINE_ACCESS_MODE: "open_beta",
    FENGINE_OPEN_BETA_MAX_USERS: "20",
    FENGINE_ALLOWED_USER_IDS: invited
  });
  assert.equal(policy.maxUsers, 20);
  assert.deepEqual([...policy.allowedOwnerIds], [invited]);
  for (const bad of ["0", "-1", "1.5", "abc", "10001"]) {
    assert.throws(
      () => accessPolicyFromEnv({ FENGINE_ACCESS_MODE: "open_beta", FENGINE_OPEN_BETA_MAX_USERS: bad }),
      /FENGINE_OPEN_BETA_MAX_USERS/
    );
  }
  assert.throws(
    () => accessPolicyFromEnv({ FENGINE_ACCESS_MODE: "open_beta", FENGINE_ALLOWED_USER_IDS: "not-a-uuid" }),
    /invalid FENGINE_ALLOWED_USER_IDS/
  );
});

function seatDb(existing) {
  const users = new Set(existing);
  return {
    users,
    async query(sql, params) {
      const [id, cap] = params;
      if (users.has(id)) return { rowCount: 0 };
      if (sql.includes("count(*)") && users.size >= cap) return { rowCount: 0 };
      users.add(id);
      return { rowCount: 1 };
    }
  };
}

test("open beta provisions new users only below the seat cap", async () => {
  const policy = accessPolicyFromEnv({ FENGINE_ACCESS_MODE: "open_beta", FENGINE_OPEN_BETA_MAX_USERS: "2" });
  const db = seatDb(["a"]);
  assert.equal(await provisionUser(db, "b", policy), true);
  assert.equal(await provisionUser(db, "c", policy), false);
  assert.deepEqual([...db.users], ["a", "b"]);
});

test("open beta always provisions allowlisted users, even when full", async () => {
  const policy = accessPolicyFromEnv({
    FENGINE_ACCESS_MODE: "open_beta",
    FENGINE_OPEN_BETA_MAX_USERS: "1",
    FENGINE_ALLOWED_USER_IDS: invited
  });
  const db = seatDb(["a"]);
  assert.equal(await provisionUser(db, invited.toUpperCase(), policy), true);
});

test("invite-only provisioning is not seat capped", async () => {
  const policy = accessPolicyFromEnv({ FENGINE_ACCESS_MODE: "invite_only", FENGINE_ALLOWED_USER_IDS: invited });
  const db = seatDb(["a", "b", "c"]);
  assert.equal(await provisionUser(db, invited, policy), true);
});
