import test from "node:test";
import assert from "node:assert/strict";
import {
  FalProviderError,
  assertNoSharedFalCredential,
  assertNoSharedPexelsCredential,
  assertNoSharedPixabayCredential,
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
  assert.throws(() => assertNoSharedPexelsCredential({ FENGINE_ENV: "hosted", PEXELS_API_KEY: "" }), /forbidden/);
  assert.throws(() => assertNoSharedPixabayCredential({ FENGINE_ENV: "hosted", PIXABAY_API_KEY: "" }), /forbidden/);
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

import {
  FAL_IMAGE_ENDPOINT_ID,
  FalImageError,
  assertFalMediaUrl,
  cancelImage,
  FAL_VIDEO_ENDPOINT_ID,
  estimateVideo,
  falVideoInput,
  submitVideo,
  videoStatus,
  videoResult,
  cancelVideo,
  assertFalVideoMediaUrl,
  estimateImage,
  falImageInput,
  imageResult,
  imageStatus,
  submitImage,
  FAL_SPEECH_ENDPOINT_ID,
  FAL_SPEECH_VOICE,
  estimateSpeech,
  falSpeechInput,
  submitSpeech,
  speechStatus,
  speechResult,
  cancelSpeech,
  FAL_LLM_DEFAULT_MODEL,
  FAL_LLM_ENDPOINT_ID,
  runFalLlm
} from "../dist/index.js";

test("estimateImage maps megapixel billing to the pinned portrait still", async () => {
  const quote = await estimateImage("synthetic:key", async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_IMAGE_ENDPOINT_ID, unit_price: 0.003, unit: "megapixels", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(quote.estimated_total, 0.003);
  assert.equal(quote.estimated_total_explanation, undefined);
  const unclear = await estimateImage("synthetic:key", async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_IMAGE_ENDPOINT_ID, unit_price: 0.01, unit: "compute second", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(unclear.estimated_total, null);
  const perImage = await estimateImage("synthetic:key", async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_IMAGE_ENDPOINT_ID, unit_price: 0.02, unit: "image", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(perImage.estimated_total, 0.02);
});

test("submitImage sends portrait payload, retention headers, and never accepts a client endpoint", async () => {
  let seen;
  const result = await submitImage("synthetic:key", { prompt: "  a quiet lighthouse  " }, async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ request_id: "req_1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  assert.equal(result.request_id, "req_1");
  assert.equal(seen.url, `https://queue.fal.run/${FAL_IMAGE_ENDPOINT_ID}`);
  assert.equal(seen.init.headers["X-Fal-Store-IO"], "0");
  assert.match(seen.init.headers["X-Fal-Object-Lifecycle-Preference"], /3600/);
  assert.deepEqual(JSON.parse(seen.init.body), falImageInput("a quiet lighthouse"));
  assert.throws(() => falImageInput(""), (error) => error instanceof FalImageError && error.code === "invalid_request");
});

test("image status, result, cancel, and fal.media URL bounds stay typed", async () => {
  assert.deepEqual(await imageStatus("k", "req", async () => new Response(JSON.stringify({ status: "IN_PROGRESS" }), {
    status: 200, headers: { "content-type": "application/json" }
  })), { status: "IN_PROGRESS" });
  const result = await imageResult("k", "req", async () => new Response(JSON.stringify({
    images: [{ url: "https://v3.fal.media/files/example.png" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(result.url, "https://v3.fal.media/files/example.png");
  assert.throws(() => assertFalMediaUrl("https://evil.example/a.png"));
  assert.throws(() => assertFalMediaUrl("https://user:pass@fal.media/a.png"));
  await cancelImage("k", "req", async () => new Response(null, { status: 202 }));
  await assert.rejects(
    submitImage("k", { prompt: "x" }, async () => new Response("no", { status: 401 })),
    (error) => error instanceof FalImageError && error.code === "credential"
  );
  await assert.rejects(
    submitImage("k", { prompt: "x" }, async () => new Response("no", { status: 429 })),
    (error) => error instanceof FalImageError && error.code === "rate_limited"
  );
});

test("estimateVideo and submitVideo pin Hailuo 6s contract without inventing totals", async () => {
  const quote = await estimateVideo("synthetic:key", async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_VIDEO_ENDPOINT_ID, unit_price: 0.19, unit: "video", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(quote.estimated_total, 0.19);
  const perUnit = await estimateVideo("synthetic:key", async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_VIDEO_ENDPOINT_ID, unit_price: 0.19, unit: "units", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(perUnit.estimated_total, 0.19);
  const unclear = await estimateVideo("synthetic:key", async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_VIDEO_ENDPOINT_ID, unit_price: 0.01, unit: "compute second", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(unclear.estimated_total, null);
  let seen;
  const submitted = await submitVideo("k", {
    prompt: "slow pan right",
    imageUrl: "https://example.invalid/signed.jpg"
  }, async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ request_id: "v1" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  });
  assert.equal(submitted.request_id, "v1");
  assert.equal(seen.url, `https://queue.fal.run/${FAL_VIDEO_ENDPOINT_ID}`);
  assert.deepEqual(JSON.parse(seen.init.body), falVideoInput("slow pan right", "https://example.invalid/signed.jpg"));
  assert.equal(JSON.parse(seen.init.body).duration, "6");
});

test("video result host allowlist accepts falserverless GCS and rejects others", async () => {
  const result = await videoResult("k", "req", async () => new Response(JSON.stringify({
    video: { url: "https://storage.googleapis.com/falserverless/example_outputs/out.mp4" }
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.match(result.url, /falserverless/);
  assert.throws(() => assertFalVideoMediaUrl("https://storage.googleapis.com/other/out.mp4"));
  assert.throws(() => assertFalVideoMediaUrl("https://evil.example/out.mp4"));
  assert.deepEqual(await videoStatus("k", "req", async () => new Response(JSON.stringify({ status: "COMPLETED" }), {
    status: 200, headers: { "content-type": "application/json" }
  })), { status: "COMPLETED" });
  await cancelVideo("k", "req", async () => new Response(null, { status: 202 }));
});

test("estimateSpeech and submitSpeech pin Kokoro without inventing totals", async () => {
  const quote = await estimateSpeech("synthetic:key", 40, async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_SPEECH_ENDPOINT_ID, unit_price: 0.02, unit: "request", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(quote.estimated_total, 0.02);
  const per1k = await estimateSpeech("synthetic:key", 1500, async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_SPEECH_ENDPOINT_ID, unit_price: 0.01, unit: "1k characters", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(per1k.estimated_total, 0.02);
  const unclear = await estimateSpeech("synthetic:key", 40, async () => new Response(JSON.stringify({
    prices: [{ endpoint_id: FAL_SPEECH_ENDPOINT_ID, unit_price: 0.01, unit: "compute second", currency: "USD" }]
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(unclear.estimated_total, null);
  let seen;
  const submitted = await submitSpeech("k", { prompt: "  Hello from the storyboard.  " }, async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ request_id: "s1" }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  });
  assert.equal(submitted.request_id, "s1");
  assert.equal(seen.url, `https://queue.fal.run/${FAL_SPEECH_ENDPOINT_ID}`);
  assert.deepEqual(JSON.parse(seen.init.body), falSpeechInput("Hello from the storyboard."));
  assert.equal(JSON.parse(seen.init.body).voice, FAL_SPEECH_VOICE);
  assert.throws(() => falSpeechInput(""), (error) => error instanceof FalImageError && error.code === "invalid_request");
  assert.throws(() => falSpeechInput("x".repeat(2001)), (error) => error instanceof FalImageError && error.code === "invalid_request");
});

test("speech result reads audio.url from fal.media and rejects other hosts", async () => {
  const result = await speechResult("k", "req", async () => new Response(JSON.stringify({
    audio: { url: "https://v3.fal.media/files/voice.wav" }
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(result.url, "https://v3.fal.media/files/voice.wav");
  await assert.rejects(
    speechResult("k", "req", async () => new Response(JSON.stringify({
      audio: { url: "https://evil.example/voice.wav" }
    }), { status: 200, headers: { "content-type": "application/json" } })),
    (error) => error instanceof FalImageError && error.code === "unsafe_output"
  );
  assert.deepEqual(await speechStatus("k", "req", async () => new Response(JSON.stringify({ status: "COMPLETED" }), {
    status: 200, headers: { "content-type": "application/json" }
  })), { status: "COMPLETED" });
  await cancelSpeech("k", "req", async () => new Response(null, { status: 202 }));
});

test("runFalLlm posts to fal-ai/any-llm and reads output without leaking bodies", async () => {
  let seen;
  const output = await runFalLlm("synthetic:key", {
    prompt: "  A lonely island  ",
    system_prompt: "JSON only",
    model: FAL_LLM_DEFAULT_MODEL
  }, async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ output: "{\"goal\":\"story\"}" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  assert.equal(output, "{\"goal\":\"story\"}");
  assert.equal(seen.url, `https://fal.run/${FAL_LLM_ENDPOINT_ID}`);
  assert.match(JSON.stringify(seen.init.headers), /synthetic:key/);
  assert.deepEqual(JSON.parse(seen.init.body), {
    prompt: "A lonely island",
    model: FAL_LLM_DEFAULT_MODEL,
    system_prompt: "JSON only"
  });
  await assert.rejects(
    runFalLlm("k", { prompt: "x" }, async () => new Response("sensitive", { status: 401 })),
    (error) => error instanceof FalImageError && error.code === "credential" && !error.message.includes("sensitive")
  );
  await assert.rejects(
    runFalLlm("k", { prompt: "x" }, async () => new Response("busy", { status: 429 })),
    (error) => error instanceof FalImageError && error.code === "rate_limited"
  );
  await assert.rejects(
    runFalLlm("k", { prompt: "" }),
    (error) => error instanceof FalImageError && error.code === "invalid_request"
  );
});
