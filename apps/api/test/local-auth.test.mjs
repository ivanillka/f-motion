import test from "node:test";
import assert from "node:assert/strict";
import { assertLocalAuthAllowed, LocalAuthForbiddenError } from "../dist/local-auth.js";

test("refuses local auth when NODE_ENV=production", () => {
  assert.throws(
    () => assertLocalAuthAllowed({ FENGINE_LOCAL_AUTH: "1", NODE_ENV: "production" }),
    LocalAuthForbiddenError
  );
});

test("refuses local auth when FENGINE_ENV=hosted", () => {
  assert.throws(
    () => assertLocalAuthAllowed({ FENGINE_LOCAL_AUTH: "1", FENGINE_ENV: "hosted" }),
    LocalAuthForbiddenError
  );
});

test("refuses local auth when FENGINE_ENV=selfhost", () => {
  assert.throws(
    () => assertLocalAuthAllowed({ FENGINE_LOCAL_AUTH: "1", FENGINE_ENV: "selfhost" }),
    LocalAuthForbiddenError
  );
});

test("allows local auth in development", () => {
  assert.doesNotThrow(() => assertLocalAuthAllowed({ FENGINE_LOCAL_AUTH: "1", NODE_ENV: "development" }));
});

test("allows local auth when NODE_ENV is unset", () => {
  assert.doesNotThrow(() => assertLocalAuthAllowed({ FENGINE_LOCAL_AUTH: "1" }));
});

test("is a no-op when FENGINE_LOCAL_AUTH is unset, even in production", () => {
  assert.doesNotThrow(() => assertLocalAuthAllowed({ NODE_ENV: "production" }));
});
