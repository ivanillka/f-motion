import test from "node:test";
import assert from "node:assert/strict";
import {
  FalProviderError,
  assertNoSharedFalCredential,
  assertNoSharedPexelsCredential,
  assertNoSharedCivitaiCredential,
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
  assert.throws(() => assertNoSharedCivitaiCredential({ FENGINE_ENV: "hosted", CIVITAI_API_KEY: "" }), /forbidden/);
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
  speakKokoroLine,
  FAL_SPEECH_MAX_BYTES,
  fetchFalSpeechAudio,
  emitFalDiagnostic,
  redactFalBody,
  setFalDiagnosticSink
} from "../dist/index.js";

/** A take is only audio once the header says RIFF/WAVE. */
function speechTake() {
  const wav = Buffer.alloc(44 + 8);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + 8, 4);
  wav.write("WAVE", 8);
  return wav;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

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

test("speakKokoroLine sends one voice and that spoken caption", async () => {
  const wav = Buffer.alloc(44 + 8);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24);
  wav.writeUInt32LE(48000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(8, 40);
  const posts = [];
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (method === "POST" && String(url).includes("kokoro/american-english")) {
      posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ request_id: `req-${posts.length}` }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/status")) {
      return new Response(JSON.stringify({ status: "COMPLETED" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (String(url).includes("/requests/")) {
      return new Response(JSON.stringify({ audio: { url: "https://v3.fal.media/files/line.wav" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(wav, {
      status: 200,
      headers: { "content-type": "audio/wav", "content-length": String(wav.length) }
    });
  };
  const first = "A room that agreed to forget the street for a while.";
  const later = "The night already had a script.";
  const firstWav = await speakKokoroLine("k", first, fetchImpl);
  const laterWav = await speakKokoroLine("k", later, fetchImpl);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].prompt, first);
  assert.equal(posts[1].prompt, later);
  assert.equal(posts[0].prompt.includes(later), false);
  assert.equal(posts[1].prompt.includes(first), false);
  assert.equal(posts[0].voice, FAL_SPEECH_VOICE);
  assert.equal(posts[1].voice, posts[0].voice);
  assert.equal(posts[0].speed, 1);
  assert.equal(posts[1].speed, 1);
  assert.equal(firstWav.byteLength, wav.length);
  assert.equal(laterWav.byteLength, wav.length);
});

test("queue status, result, and cancel address the app pair instead of the submit path", async () => {
  const calls = [];
  const respondent = (body) => async (url, init) => {
    calls.push([init.method, String(url)]);
    return new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  // Endpoint ids carry a submit path after the app pair (flux/schnell, minimax/hailuo.../...,
  // kokoro/american-english); queue.fal.run only routes {owner}/{alias}/requests/{id} to the
  // queue service, so the request routes must not repeat that path.
  const appBase = (endpointId) => `https://queue.fal.run/${endpointId.split("/").slice(0, 2).join("/")}`;
  const requestId = "req 1/2";
  const encoded = encodeURIComponent(requestId);
  assert.deepEqual(await imageStatus("k", requestId, respondent({ status: "IN_PROGRESS" })), { status: "IN_PROGRESS" });
  assert.equal((await imageResult("k", requestId, respondent({
    images: [{ url: "https://v3.fal.media/files/example.png" }]
  }))).url, "https://v3.fal.media/files/example.png");
  await cancelImage("k", requestId, respondent(null));
  assert.deepEqual(await videoStatus("k", requestId, respondent({ status: "COMPLETED" })), { status: "COMPLETED" });
  assert.equal((await videoResult("k", requestId, respondent({
    video: { url: "https://storage.googleapis.com/falserverless/example_outputs/out.mp4" }
  }))).url, "https://storage.googleapis.com/falserverless/example_outputs/out.mp4");
  await cancelVideo("k", requestId, respondent(null));
  assert.deepEqual(await speechStatus("k", requestId, respondent({ status: "IN_PROGRESS" })), { status: "IN_PROGRESS" });
  assert.equal((await speechResult("k", requestId, respondent({
    audio: { url: "https://v3.fal.media/files/voice.wav" }
  }))).url, "https://v3.fal.media/files/voice.wav");
  await cancelSpeech("k", requestId, respondent(null));
  // Probed 2026-10-12: the path-ful form answers 405 with `allow: POST` because it lands on the
  // submit route, which surfaces as provider_unavailable; the app-pair form reaches the queue
  // service and answers {"status":"NOT_FOUND"} for an unknown id.
  assert.deepEqual(calls, [
    ["GET", `${appBase(FAL_IMAGE_ENDPOINT_ID)}/requests/${encoded}/status`],
    ["GET", `${appBase(FAL_IMAGE_ENDPOINT_ID)}/requests/${encoded}`],
    ["PUT", `${appBase(FAL_IMAGE_ENDPOINT_ID)}/requests/${encoded}/cancel`],
    ["GET", `${appBase(FAL_VIDEO_ENDPOINT_ID)}/requests/${encoded}/status`],
    ["GET", `${appBase(FAL_VIDEO_ENDPOINT_ID)}/requests/${encoded}`],
    ["PUT", `${appBase(FAL_VIDEO_ENDPOINT_ID)}/requests/${encoded}/cancel`],
    ["GET", `${appBase(FAL_SPEECH_ENDPOINT_ID)}/requests/${encoded}/status`],
    ["GET", `${appBase(FAL_SPEECH_ENDPOINT_ID)}/requests/${encoded}`],
    ["PUT", `${appBase(FAL_SPEECH_ENDPOINT_ID)}/requests/${encoded}/cancel`]
  ]);
  assert.notEqual(appBase(FAL_SPEECH_ENDPOINT_ID), `https://queue.fal.run/${FAL_SPEECH_ENDPOINT_ID}`);
});

test("a busy Kokoro queue is polled to its deadline and reported through the sink", async () => {
  const wav = speechTake();
  const events = [];
  setFalDiagnosticSink((event) => events.push(event));
  const credential = "fal-secret-key:1234";
  // FAL queues are shared: the line answers IN_QUEUE with a place in line first.
  const queue = ["IN_QUEUE", "COMPLETED"];
  const fetchImpl = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const target = String(url);
    if (method === "POST" && !target.includes("/requests/")) {
      return jsonResponse({
        request_id: "req-slow",
        signed_url: "https://v3.fal.media/files/voice.wav?token=tok-abc",
        api_key: "api-key-value",
        queue: { authorization: "Bearer tok-abc" }
      });
    }
    if (target.endsWith("/status")) {
      const state = queue.shift();
      return jsonResponse(state === "IN_QUEUE" ? { status: state, queue_position: 4 } : { status: state });
    }
    if (target.includes("/requests/")) {
      return jsonResponse({ audio: { url: "https://v3.fal.media/files/voice.wav?sig=1" } });
    }
    return new Response(wav, {
      status: 200,
      headers: { "content-type": "audio/wav", "content-length": String(wav.length) }
    });
  };
  try {
    const bytes = await speakKokoroLine(credential, "A busy queue.", fetchImpl, 20_000);
    assert.equal(bytes.byteLength, wav.length);
    const submit = events.find((event) => event.stage === "submit");
    assert.equal(submit.requestId, "req-slow");
    assert.equal(submit.body.request_id, "req-slow");
    assert.equal(submit.body.signed_url, "(redacted)");
    assert.equal(submit.body.api_key, "(redacted)");
    assert.equal(submit.body.queue.authorization, "(redacted)");
    assert.deepEqual(
      events.filter((event) => event.stage === "status").map((event) => [event.status, event.queuePosition]),
      [["IN_QUEUE", 4], ["COMPLETED", undefined]]
    );
    // The signed take URL never reaches the sink; the result body keeps the shape only.
    assert.equal(events.find((event) => event.stage === "result").body.audio.url, "(redacted)");
    assert.equal(events.find((event) => event.stage === "download").contentType, "audio/wav");
    assert.equal(events.find((event) => event.stage === "download").bytes, wav.length);
    const logged = JSON.stringify(events);
    assert.equal(logged.includes("tok-abc"), false);
    assert.equal(logged.includes("api-key-value"), false);
    assert.equal(logged.includes(credential), false);

    // A queue that never finishes runs to the deadline and reports what it last saw.
    let polls = 0;
    const stuckFetch = async (_url, init = {}) => {
      if (String(init.method || "GET").toUpperCase() === "POST") {
        return jsonResponse({ request_id: "req-stuck" });
      }
      polls += 1;
      return jsonResponse({ status: "IN_QUEUE", queue_position: 9 });
    };
    await assert.rejects(
      speakKokoroLine(credential, "Still queued.", stuckFetch, 1_200),
      (error) => error instanceof FalImageError && error.code === "provider_unavailable"
    );
    const timeout = events.find((event) => event.stage === "timeout");
    assert.equal(timeout.requestId, "req-stuck");
    assert.equal(timeout.status, "IN_QUEUE");
    assert.equal(timeout.code, "provider_unavailable");
    assert.ok(timeout.elapsedMs >= 1_000);
    assert.ok(polls >= 2);

    // A diagnostic never breaks a voice line.
    setFalDiagnosticSink(() => { throw new Error("sink down"); });
    assert.doesNotThrow(() => emitFalDiagnostic({ stage: "submit", endpoint: FAL_SPEECH_ENDPOINT_ID }));
  } finally {
    setFalDiagnosticSink(undefined);
  }
});

test("a speech take is only fetched from fal.media and only when it is audio", async () => {
  const wav = speechTake();
  const media = "https://v3.fal.media/files/voice.wav?sig=1";
  // A signed take URL cannot bounce the download to another origin.
  for (const location of ["https://evil.example/voice.wav", "http://v3.fal.media/files/voice.wav"]) {
    await assert.rejects(
      fetchFalSpeechAudio(media, async () => new Response(null, { status: 302, headers: { location } })),
      (error) => error instanceof FalImageError && error.code === "unsafe_output"
    );
  }
  let requested = false;
  await assert.rejects(
    fetchFalSpeechAudio("https://evil.example/voice.wav", async () => {
      requested = true;
      return new Response(wav);
    }),
    (error) => error instanceof FalImageError && error.code === "unsafe_output"
  );
  assert.equal(requested, false);
  // Five redirects are followed; the sixth is refused instead of spinning.
  let hops = 0;
  await assert.rejects(
    fetchFalSpeechAudio(media, async () => {
      hops += 1;
      return new Response(null, { status: 307, headers: { location: media } });
    }),
    (error) => error instanceof FalImageError && error.code === "unsafe_output"
  );
  assert.equal(hops, 6);
  // A hop to another fal.media host is re-validated and followed by hand.
  const seen = [];
  const followed = await fetchFalSpeechAudio(media, async (url, init = {}) => {
    seen.push([String(url), init.redirect]);
    if (seen.length === 1) {
      return new Response(null, { status: 307, headers: { location: "https://v4.fal.media/files/voice.wav?sig=2" } });
    }
    return new Response(wav, {
      status: 200,
      headers: { "content-type": "audio/wav", "content-length": String(wav.length) }
    });
  });
  assert.deepEqual(seen, [
    [media, "manual"],
    ["https://v4.fal.media/files/voice.wav?sig=2", "manual"]
  ]);
  assert.equal((await followed.arrayBuffer()).byteLength, wav.length);
  // HTML and an oversized take are provider mistakes, not a voice.
  await assert.rejects(
    fetchFalSpeechAudio(media, async () => new Response("<html>", {
      status: 200,
      headers: { "content-type": "text/html" }
    })),
    (error) => error instanceof FalImageError && error.code === "unsafe_output"
  );
  await assert.rejects(
    fetchFalSpeechAudio(media, async () => new Response(wav, {
      status: 200,
      headers: { "content-type": "audio/wav", "content-length": String(FAL_SPEECH_MAX_BYTES + 1) }
    })),
    (error) => error instanceof FalImageError && error.code === "unsafe_output"
  );
  // A refused or unreachable download is a provider hiccup the caller retries.
  for (const fetchImpl of [
    async () => new Response("busy", { status: 503 }),
    async () => { throw new Error("socket"); }
  ]) {
    await assert.rejects(
      fetchFalSpeechAudio(media, fetchImpl),
      (error) => error instanceof FalImageError && error.code === "provider_unavailable"
    );
  }
});

test("a failed or unknown Kokoro queue state is reported once with its code", async () => {
  const events = [];
  setFalDiagnosticSink((event) => events.push(event));
  try {
    assert.deepEqual(
      await speechStatus("k", "req-queued", async () => jsonResponse({ status: "IN_QUEUE", queue_position: 2 })),
      { status: "IN_QUEUE" }
    );
    assert.equal(events.at(-1).stage, "status");
    assert.equal(events.at(-1).queuePosition, 2);
    // FAILED is the provider refusing the line, which is the shared speech status
    // code for a refused take, exactly as imageStatus and videoStatus report it.
    assert.deepEqual(
      await speechStatus("k", "req-failed", async () => jsonResponse({
        status: "FAILED",
        detail: "refused by the voice model",
        signed_url: "https://v3.fal.media/files/voice.wav?sig=9"
      })),
      { status: "FAILED", failureCode: "unsafe_output" }
    );
    assert.equal(events.at(-1).stage, "failure");
    assert.equal(events.at(-1).code, "unsafe_output");
    assert.equal(events.at(-1).body.detail, "refused by the voice model");
    assert.equal(events.at(-1).body.signed_url, "(redacted)");
    // An unknown state is a provider failure, not a verdict on the caption.
    await assert.rejects(
      speechStatus("k", "req-unknown", async () => jsonResponse({ status: "NOT_FOUND" })),
      (error) => error instanceof FalImageError && error.code === "provider_unavailable"
    );
    assert.equal(events.at(-1).status, "NOT_FOUND");
    assert.equal(events.at(-1).code, "provider_unavailable");
    // A body without a status field is not COMPLETED.
    await assert.rejects(
      speechStatus("k", "req-empty", async () => jsonResponse({ queue_position: 0 })),
      (error) => error instanceof FalImageError && error.code === "provider_unavailable"
    );
    assert.equal(events.at(-1).status, "(empty)");
  } finally {
    setFalDiagnosticSink(undefined);
  }
});

test("diagnostic bodies keep the provider shape and drop secrets and long strings", () => {
  const redacted = redactFalBody({
    status: "FAILED",
    audio: { url: "https://v3.fal.media/files/voice.wav?sig=9" },
    note: "https://v3.fal.media/files/voice.wav?sig=9",
    apiKey: "abc",
    long: "x".repeat(400),
    deep: { a: { b: { c: { d: { e: "far" } } } } },
    list: [1, 2, 3, 4, 5, 6, 7]
  });
  assert.equal(redacted.status, "FAILED");
  assert.equal(redacted.audio.url, "(redacted)");
  assert.equal(redacted.note, "v3.fal.media/…");
  assert.equal(redacted.apiKey, "(redacted)");
  assert.equal(redacted.long.length, 201);
  assert.equal(redacted.deep.a.b.c, "(truncated)");
  assert.equal(redacted.list.length, 5);
});
