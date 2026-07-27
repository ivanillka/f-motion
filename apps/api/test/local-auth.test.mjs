import test from "node:test";
import assert from "node:assert/strict";
import { assertLocalAuthAllowed, LocalAuthForbiddenError } from "../dist/local-auth.js";

test("refuses local auth when NODE_ENV=production", () => {
  assert.throws(
    () => assertLocalAuthAllowed({ FMOTION_LOCAL_AUTH: "1", NODE_ENV: "production" }),
    LocalAuthForbiddenError
  );
});

test("refuses local auth when FMOTION_ENV=hosted", () => {
  assert.throws(
    () => assertLocalAuthAllowed({ FMOTION_LOCAL_AUTH: "1", FMOTION_ENV: "hosted" }),
    LocalAuthForbiddenError
  );
});

test("allows local auth in development", () => {
  assert.doesNotThrow(() => assertLocalAuthAllowed({ FMOTION_LOCAL_AUTH: "1", NODE_ENV: "development" }));
});

test("allows local auth when NODE_ENV is unset", () => {
  assert.doesNotThrow(() => assertLocalAuthAllowed({ FMOTION_LOCAL_AUTH: "1" }));
});

test("is a no-op when FMOTION_LOCAL_AUTH is unset, even in production", () => {
  assert.doesNotThrow(() => assertLocalAuthAllowed({ NODE_ENV: "production" }));
});
