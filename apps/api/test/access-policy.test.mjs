import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountUnavailableError,
  accessPolicyFromEnv,
  assertOwnerAdmitted
} from "../dist/access-policy.js";

const invited = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";

test("verified provisioning remains the local compatibility default", () => {
  const policy = accessPolicyFromEnv({});
  assert.equal(policy.mode, "provision_verified");
  assert.doesNotThrow(() => assertOwnerAdmitted("any-subject", policy));
});

test("invite-only admits exact configured Supabase subjects", () => {
  const policy = accessPolicyFromEnv({
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
