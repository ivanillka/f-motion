import test from "node:test";
import assert from "node:assert/strict";
import {
  FalProviderError,
  assertNoSharedFalCredential,
  credentialVaultFromEnv,
  decryptCredential,
  encryptCredential,
  falByokEnabled,
  normalizeFalCredential,
  validateFalCredential
} from "../dist/index.js";

const key = Buffer.alloc(32, 7).toString("base64");
const env = {
  FENGINE_FAL_BYOK_ENABLED: "1",
  FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
  FENGINE_CREDENTIAL_KEY_V1: key
};
const identity = { id: "credential", ownerId: "owner", provider: "fal" };

test("credential encryption is randomized, authenticated, and owner bound", () => {
  const vault = credentialVaultFromEnv(env);
  const first = encryptCredential("synthetic:key", identity, vault);
  const second = encryptCredential("synthetic:key", identity, vault);
  assert.equal(decryptCredential(first, identity, vault), "synthetic:key");
  assert.notDeepEqual(first.nonce, second.nonce);
  assert.throws(() => decryptCredential(first, { ...identity, ownerId: "other" }, vault));
  const tampered = { ...first, ciphertext: Uint8Array.from(first.ciphertext) };
  tampered.ciphertext[0] ^= 1;
  assert.throws(() => decryptCredential(tampered, identity, vault));
});

test("credential configuration fails closed", () => {
  assert.equal(falByokEnabled({}), false);
  assert.equal(falByokEnabled({ FENGINE_FAL_BYOK_ENABLED: "0" }), false);
  assert.equal(falByokEnabled(env), true);
  assert.throws(() => falByokEnabled({ FENGINE_FAL_BYOK_ENABLED: "yes" }));
  assert.throws(() => credentialVaultFromEnv({ ...env, FENGINE_CREDENTIAL_KEY_V1: "short" }));
  assert.throws(() => assertNoSharedFalCredential({ FENGINE_ENV: "hosted", FAL_KEY: "synthetic" }), /forbidden/);
  assert.throws(() => assertNoSharedFalCredential({ NODE_ENV: "production", FAL_API_KEY: "synthetic" }), /forbidden/);
  assert.throws(() => assertNoSharedFalCredential({ FENGINE_ENV: "hosted", FAL_KEY: "" }), /forbidden/);
  assert.doesNotThrow(() => assertNoSharedFalCredential({ FENGINE_ENV: "hosted" }));
});

test("FAL credential input is bounded without assuming provider syntax", () => {
  assert.equal(normalizeFalCredential("  id:secret  "), "id:secret");
  assert.throws(() => normalizeFalCredential(""));
  assert.throws(() => normalizeFalCredential("contains space"));
  assert.throws(() => normalizeFalCredential("x".repeat(513)));
});

test("FAL pricing validation maps provider results without leaking bodies", async () => {
  const ok = async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: "fal-ai/flux/schnell", unit_price: 0.003, unit: "megapixel", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  await validateFalCredential("synthetic:key", ok);
  for (const status of [401, 403]) {
    await assert.rejects(
      validateFalCredential("synthetic:key", async () => new Response("sensitive upstream body", { status })),
      (error) => error instanceof FalProviderError && error.code === "credential" && !error.message.includes("sensitive")
    );
  }
  for (const response of [
    new Response("busy", { status: 429 }),
    new Response("broken", { status: 500 }),
    new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ prices: [] }), { status: 200, headers: { "content-type": "text/plain" } }),
    new Response(JSON.stringify({ prices: [] }), { status: 200, headers: { "content-type": "application/json" } })
  ]) {
    await assert.rejects(
      validateFalCredential("synthetic:key", async () => response),
      (error) => error instanceof FalProviderError && error.code === "unavailable"
    );
  }
  await assert.rejects(
    validateFalCredential("synthetic:key", async () => { throw new Error("synthetic:key"); }),
    (error) => error instanceof FalProviderError && !error.message.includes("synthetic")
  );
  await assert.rejects(
    validateFalCredential("synthetic:key", async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("synthetic:key")), { once: true });
    }), 5),
    (error) => error instanceof FalProviderError && error.code === "unavailable"
  );
});
