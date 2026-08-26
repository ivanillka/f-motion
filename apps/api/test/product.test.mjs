import test from "node:test";
import assert from "node:assert/strict";
import { assertProductIsolation, engineEnv, productFlavor } from "../dist/product.js";

test("engineEnv prefers FENGINE_ENV then FMOTION_ENV", () => {
  assert.equal(engineEnv({ FENGINE_ENV: "selfhost", FMOTION_ENV: "hosted" }), "selfhost");
  assert.equal(engineEnv({ FMOTION_ENV: "selfhost" }), "selfhost");
  assert.equal(engineEnv({}), undefined);
});

test("product flavors are VPS, f-motion.com, and reserved corporate", () => {
  assert.equal(productFlavor({ FENGINE_ENV: "selfhost" }), "selfhost");
  assert.equal(productFlavor({ FENGINE_ENV: "hosted" }), "hosted");
  assert.equal(productFlavor({ FENGINE_ENV: "corporate" }), "corporate");
  assert.equal(productFlavor({}), undefined);
  assert.throws(() => productFlavor({ FENGINE_ENV: "staging" }), /unknown FENGINE_ENV/);
});

test("VPS product rejects Supabase, Stripe, and hosted invite lists", () => {
  assert.equal(assertProductIsolation({ FENGINE_ENV: "selfhost" }), "selfhost");
  assert.throws(
    () => assertProductIsolation({ FENGINE_ENV: "selfhost", SUPABASE_ISSUER: "https://auth.example" }),
    /f-motion.com/
  );
  assert.throws(
    () => assertProductIsolation({ FENGINE_ENV: "selfhost", STRIPE_SECRET_KEY: "sk_test" }),
    /f-motion.com/
  );
  assert.throws(
    () => assertProductIsolation({ FENGINE_ENV: "selfhost", FENGINE_ACCESS_MODE: "invite_only" }),
    /invite_only/
  );
});

test("corporate teams product is reserved and does not boot", () => {
  assert.throws(
    () => assertProductIsolation({ FENGINE_ENV: "corporate" }),
    /teams product/
  );
});

test("hosted product rejects leftover bootstrap tokens", () => {
  assert.equal(assertProductIsolation({ FENGINE_ENV: "hosted" }), "hosted");
  assert.throws(
    () => assertProductIsolation({ FENGINE_ENV: "hosted", FENGINE_BOOTSTRAP_TOKEN: "x".repeat(32) }),
    /f-motion.com/
  );
});
