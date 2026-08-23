import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBootstrapAuthorization,
  assertSelfhostConfig,
  engineEnv
} from "../dist/selfhost-auth.js";
import { UnauthorizedError } from "../dist/auth.js";

test("engineEnv prefers FENGINE_ENV then FMOTION_ENV", () => {
  assert.equal(engineEnv({ FENGINE_ENV: "selfhost", FMOTION_ENV: "hosted" }), "selfhost");
  assert.equal(engineEnv({ FMOTION_ENV: "selfhost" }), "selfhost");
  assert.equal(engineEnv({}), undefined);
});

test("selfhost config requires a 32+ character bootstrap token and forbids local auth", () => {
  assert.throws(() => assertSelfhostConfig({}), /selfhost/);
  assert.throws(
    () => assertSelfhostConfig({ FENGINE_ENV: "selfhost", FENGINE_LOCAL_AUTH: "1", FENGINE_BOOTSTRAP_TOKEN: "a".repeat(32) }),
    /FENGINE_LOCAL_AUTH/
  );
  assert.throws(
    () => assertSelfhostConfig({ FENGINE_ENV: "selfhost", FENGINE_BOOTSTRAP_TOKEN: "short" }),
    /BOOTSTRAP_TOKEN/
  );
  assert.equal(
    assertSelfhostConfig({ FMOTION_ENV: "selfhost", FMOTION_BOOTSTRAP_TOKEN: "b".repeat(32) }),
    "b".repeat(32)
  );
});

test("bootstrap bearer compare is exact", () => {
  const token = "c".repeat(32);
  assert.doesNotThrow(() => assertBootstrapAuthorization(`Bearer ${token}`, token));
  assert.throws(() => assertBootstrapAuthorization("Bearer wrong", token), UnauthorizedError);
  assert.throws(() => assertBootstrapAuthorization(undefined, token), UnauthorizedError);
});
