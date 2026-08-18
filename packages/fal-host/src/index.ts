import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const falPricingUrl = "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fflux%2Fschnell";
export const FAL_IMAGE_ENDPOINT_ID = "fal-ai/flux/schnell";
const falEndpointId = FAL_IMAGE_ENDPOINT_ID;
const falQueueBase = `https://queue.fal.run/${FAL_IMAGE_ENDPOINT_ID}`;
const falImageMaxPrompt = 500;
const falHttpTimeoutMs = 30_000;

export type FalImageErrorCode =
  | "credential"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_request"
  | "unsafe_output";

export class FalImageError extends Error {
  readonly name = "FalImageError";

  constructor(readonly code: FalImageErrorCode) {
    super(code);
  }
}

export interface FalImageQuote {
  endpoint_id: string;
  unit_price: number;
  unit: string;
  currency: string;
  /** Honest total when the billing unit maps to one portrait image; otherwise null. */
  estimated_total: number | null;
  estimated_total_explanation?: string;
}

export interface FalImageSubmitResult {
  request_id: string;
}

export type FalImageStatus =
  | { status: "IN_QUEUE" | "IN_PROGRESS" }
  | { status: "COMPLETED" }
  | { status: "FAILED"; failureCode: FalImageErrorCode };

export interface FalImageResult {
  url: string;
  contentType?: string;
}

function classifyHttp(status: number): FalImageErrorCode {
  if (status === 401 || status === 403) return "credential";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "invalid_request";
  return "provider_unavailable";
}

async function falJson(
  credential: string,
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers: {
          authorization: `Key ${credential}`,
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });
    } catch {
      throw new FalImageError("provider_unavailable");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    let body: unknown = null;
    if (contentType.includes("application/json")) {
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function normalizeImagePrompt(prompt: unknown): string {
  if (typeof prompt !== "string") throw new FalImageError("invalid_request");
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.length > falImageMaxPrompt) throw new FalImageError("invalid_request");
  return trimmed;
}

function pickPrice(body: unknown): FalImageQuote {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FalImageError("provider_unavailable");
  }
  const prices = (body as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) throw new FalImageError("provider_unavailable");
  const match = prices.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const price = item as Record<string, unknown>;
    return price.endpoint_id === falEndpointId
      && typeof price.unit_price === "number"
      && Number.isFinite(price.unit_price)
      && price.unit_price >= 0
      && typeof price.unit === "string"
      && typeof price.currency === "string";
  }) as { endpoint_id: string; unit_price: number; unit: string; currency: string } | undefined;
  if (!match) throw new FalImageError("provider_unavailable");
  const unit = match.unit.toLowerCase();
  // One portrait still is billed per megapixel on Flux Schnell; totals stay null
  // unless the unit is an honest per-image / per-request charge.
  const perImage = unit === "image" || unit === "images" || unit === "request" || unit === "requests";
  return {
    endpoint_id: match.endpoint_id,
    unit_price: match.unit_price,
    unit: match.unit,
    currency: match.currency,
    estimated_total: perImage ? match.unit_price : null,
    ...(perImage ? {} : {
      estimated_total_explanation: `FAL bills this model per ${match.unit}; a fixed dollar total is not computed for one still.`
    })
  };
}

export async function estimateImage(
  credential: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalImageQuote> {
  const { status, body } = await falJson(credential, falPricingUrl, { method: "GET" }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  return pickPrice(body);
}

export function falImageInput(prompt: string): Record<string, unknown> {
  return {
    prompt: normalizeImagePrompt(prompt),
    image_size: "portrait_16_9",
    num_images: 1,
    enable_safety_checker: true
  };
}

export async function submitImage(
  credential: string,
  input: { prompt: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalImageSubmitResult> {
  const payload = falImageInput(input.prompt);
  const { status, body } = await falJson(credential, falQueueBase, {
    method: "POST",
    headers: {
      "X-Fal-Store-IO": "0",
      "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 3600 })
    },
    body: JSON.stringify(payload)
  }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status === 429) throw new FalImageError("rate_limited");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const requestId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { request_id?: unknown }).request_id
    : undefined;
  if (typeof requestId !== "string" || !requestId.trim()) throw new FalImageError("provider_unavailable");
  return { request_id: requestId.trim() };
}

export async function imageStatus(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalImageStatus> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${falQueueBase}/requests/${encodeURIComponent(requestId)}/status`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const state = body && typeof body === "object" && !Array.isArray(body)
    ? String((body as { status?: unknown }).status ?? "")
    : "";
  if (state === "IN_QUEUE" || state === "IN_PROGRESS") return { status: state };
  if (state === "COMPLETED") return { status: "COMPLETED" };
  if (state === "FAILED") return { status: "FAILED", failureCode: "unsafe_output" };
  throw new FalImageError("provider_unavailable");
}

function firstFalMediaUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string") return record.url;
  if (Array.isArray(record.images) && record.images[0]) return firstFalMediaUrl(record.images[0]);
  if (record.image) return firstFalMediaUrl(record.image);
  return undefined;
}

export function assertFalMediaUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FalImageError("unsafe_output");
  }
  if (parsed.protocol !== "https:") throw new FalImageError("unsafe_output");
  if (parsed.username || parsed.password) throw new FalImageError("unsafe_output");
  if (parsed.port && parsed.port !== "443") throw new FalImageError("unsafe_output");
  const host = parsed.hostname.toLowerCase();
  if (host !== "fal.media" && !host.endsWith(".fal.media")) throw new FalImageError("unsafe_output");
  return parsed;
}

export async function imageResult(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalImageResult> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${falQueueBase}/requests/${encodeURIComponent(requestId)}`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const url = firstFalMediaUrl(body);
  if (!url) throw new FalImageError("unsafe_output");
  assertFalMediaUrl(url);
  return { url };
}

export async function cancelImage(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<void> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status } = await falJson(
    credential,
    `${falQueueBase}/requests/${encodeURIComponent(requestId)}/cancel`,
    { method: "PUT" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status === 404) return;
  if (!status.toString().startsWith("2") && status !== 409) {
    throw new FalImageError(classifyHttp(status));
  }
}


export const FAL_VIDEO_ENDPOINT_ID = "fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video";
const falVideoPricingUrl =
  "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fminimax%2Fhailuo-2.3-fast%2Fstandard%2Fimage-to-video";
const falVideoQueueBase = `https://queue.fal.run/${FAL_VIDEO_ENDPOINT_ID}`;
/** Contract checked 2026-08-02 against fal.ai Hailuo 2.3 Fast standard image-to-video docs. */
export const FAL_VIDEO_DURATION = "6" as const;
export const FAL_VIDEO_MAX_BYTES = 100_000_000;

export type FalVideoQuote = FalImageQuote;
export type FalVideoSubmitResult = FalImageSubmitResult;
export type FalVideoStatus = FalImageStatus;
export type FalVideoResult = FalImageResult;

function pickVideoPrice(body: unknown): FalVideoQuote {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FalImageError("provider_unavailable");
  }
  const prices = (body as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) throw new FalImageError("provider_unavailable");
  const match = prices.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const price = item as Record<string, unknown>;
    return price.endpoint_id === FAL_VIDEO_ENDPOINT_ID
      && typeof price.unit_price === "number"
      && Number.isFinite(price.unit_price)
      && price.unit_price >= 0
      && typeof price.unit === "string"
      && typeof price.currency === "string";
  }) as { endpoint_id: string; unit_price: number; unit: string; currency: string } | undefined;
  if (!match) throw new FalImageError("provider_unavailable");
  const unit = match.unit.toLowerCase();
  // Honest 6s total only when the unit is clearly one video / one request / 6 seconds.
  const perSixSecond = unit === "video" || unit === "videos" || unit === "request" || unit === "requests"
    || unit === "6 second" || unit === "6 seconds" || (unit.includes("6") && unit.includes("second"));
  return {
    endpoint_id: match.endpoint_id,
    unit_price: match.unit_price,
    unit: match.unit,
    currency: match.currency,
    estimated_total: perSixSecond ? match.unit_price : null,
    ...(perSixSecond ? {} : {
      estimated_total_explanation: `FAL bills this model per ${match.unit}; a fixed dollar total is not computed for one 6-second video.`
    })
  };
}

export async function estimateVideo(
  credential: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalVideoQuote> {
  const { status, body } = await falJson(credential, falVideoPricingUrl, { method: "GET" }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  return pickVideoPrice(body);
}

export function falVideoInput(prompt: string, imageUrl: string): Record<string, unknown> {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
    throw new FalImageError("invalid_request");
  }
  return {
    prompt: normalizeImagePrompt(prompt),
    image_url: imageUrl,
    prompt_optimizer: true,
    duration: FAL_VIDEO_DURATION
  };
}

export async function submitVideo(
  credential: string,
  input: { prompt: string; imageUrl: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalVideoSubmitResult> {
  const payload = falVideoInput(input.prompt, input.imageUrl);
  const { status, body } = await falJson(credential, falVideoQueueBase, {
    method: "POST",
    headers: {
      "X-Fal-Store-IO": "0",
      "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 3600 })
    },
    body: JSON.stringify(payload)
  }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status === 429) throw new FalImageError("rate_limited");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const requestId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { request_id?: unknown }).request_id
    : undefined;
  if (typeof requestId !== "string" || !requestId.trim()) throw new FalImageError("provider_unavailable");
  return { request_id: requestId.trim() };
}

export async function videoStatus(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalVideoStatus> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${falVideoQueueBase}/requests/${encodeURIComponent(requestId)}/status`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const state = body && typeof body === "object" && !Array.isArray(body)
    ? String((body as { status?: unknown }).status ?? "")
    : "";
  if (state === "IN_QUEUE" || state === "IN_PROGRESS") return { status: state };
  if (state === "COMPLETED") return { status: "COMPLETED" };
  if (state === "FAILED") return { status: "FAILED", failureCode: "unsafe_output" };
  throw new FalImageError("provider_unavailable");
}

function firstFalVideoUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.video) return firstFalVideoUrl(record.video);
  if (typeof record.url === "string") return record.url;
  return undefined;
}

/** Endpoint-specific allowlist checked 2026-08-02: falserverless GCS + fal.media. */
export function assertFalVideoMediaUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new FalImageError("unsafe_output");
  }
  if (parsed.protocol !== "https:") throw new FalImageError("unsafe_output");
  if (parsed.username || parsed.password) throw new FalImageError("unsafe_output");
  if (parsed.port && parsed.port !== "443") throw new FalImageError("unsafe_output");
  const host = parsed.hostname.toLowerCase();
  if (host === "fal.media" || host.endsWith(".fal.media")) return parsed;
  if (host === "storage.googleapis.com" && parsed.pathname.startsWith("/falserverless/")) return parsed;
  throw new FalImageError("unsafe_output");
}

export async function videoResult(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalVideoResult> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${falVideoQueueBase}/requests/${encodeURIComponent(requestId)}`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const url = firstFalVideoUrl(body);
  if (!url) throw new FalImageError("unsafe_output");
  assertFalVideoMediaUrl(url);
  return { url };
}

export async function cancelVideo(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<void> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status } = await falJson(
    credential,
    `${falVideoQueueBase}/requests/${encodeURIComponent(requestId)}/cancel`,
    { method: "PUT" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status === 404) return;
  if (!status.toString().startsWith("2") && status !== 409) {
    throw new FalImageError(classifyHttp(status));
  }
}

/** Contract checked 2026-08-18 against fal.ai Kokoro American English docs. */
export const FAL_SPEECH_ENDPOINT_ID = "fal-ai/kokoro/american-english";
export const FAL_SPEECH_VOICE = "af_heart";
export const FAL_SPEECH_MAX_PROMPT = 2000;
export const FAL_SPEECH_MAX_BYTES = 25_000_000;
const falSpeechPricingUrl =
  "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fkokoro%2Famerican-english";
const falSpeechQueueBase = `https://queue.fal.run/${FAL_SPEECH_ENDPOINT_ID}`;

export type FalSpeechQuote = FalImageQuote;
export type FalSpeechSubmitResult = FalImageSubmitResult;
export type FalSpeechStatus = FalImageStatus;
export type FalSpeechResult = FalImageResult;

function normalizeSpeechPrompt(prompt: unknown): string {
  if (typeof prompt !== "string") throw new FalImageError("invalid_request");
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.length > FAL_SPEECH_MAX_PROMPT) throw new FalImageError("invalid_request");
  return trimmed;
}

function pickSpeechPrice(body: unknown, promptLength: number): FalSpeechQuote {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FalImageError("provider_unavailable");
  }
  const prices = (body as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) throw new FalImageError("provider_unavailable");
  const match = prices.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const price = item as Record<string, unknown>;
    return price.endpoint_id === FAL_SPEECH_ENDPOINT_ID
      && typeof price.unit_price === "number"
      && Number.isFinite(price.unit_price)
      && price.unit_price >= 0
      && typeof price.unit === "string"
      && typeof price.currency === "string";
  }) as { endpoint_id: string; unit_price: number; unit: string; currency: string } | undefined;
  if (!match) throw new FalImageError("provider_unavailable");
  const unit = match.unit.toLowerCase();
  const perRequest = unit === "request" || unit === "requests" || unit === "audio" || unit === "audios"
    || unit === "clip" || unit === "clips";
  const perThousandChars = (unit.includes("character") || unit.includes("char"))
    && (/1\s*k/.test(unit) || unit.includes("1000") || unit.includes("1,000"));
  const perChar = (unit === "character" || unit === "characters" || unit === "char" || unit === "chars")
    && !perThousandChars;
  let estimated_total: number | null = null;
  if (perRequest) estimated_total = match.unit_price;
  else if (perThousandChars) estimated_total = match.unit_price * Math.max(1, Math.ceil(promptLength / 1000));
  else if (perChar) estimated_total = match.unit_price * promptLength;
  return {
    endpoint_id: match.endpoint_id,
    unit_price: match.unit_price,
    unit: match.unit,
    currency: match.currency,
    estimated_total,
    ...(estimated_total === null ? {
      estimated_total_explanation: `FAL bills this model per ${match.unit}; a fixed dollar total is not computed for this voice-over.`
    } : {})
  };
}

export async function estimateSpeech(
  credential: string,
  promptLength: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalSpeechQuote> {
  if (!Number.isInteger(promptLength) || promptLength <= 0 || promptLength > FAL_SPEECH_MAX_PROMPT) {
    throw new FalImageError("invalid_request");
  }
  const { status, body } = await falJson(credential, falSpeechPricingUrl, { method: "GET" }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  return pickSpeechPrice(body, promptLength);
}

export function falSpeechInput(prompt: string): Record<string, unknown> {
  return {
    prompt: normalizeSpeechPrompt(prompt),
    voice: FAL_SPEECH_VOICE,
    speed: 1
  };
}

export async function submitSpeech(
  credential: string,
  input: { prompt: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalSpeechSubmitResult> {
  const payload = falSpeechInput(input.prompt);
  const { status, body } = await falJson(credential, falSpeechQueueBase, {
    method: "POST",
    headers: {
      "X-Fal-Store-IO": "0",
      "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 3600 })
    },
    body: JSON.stringify(payload)
  }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status === 429) throw new FalImageError("rate_limited");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const requestId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { request_id?: unknown }).request_id
    : undefined;
  if (typeof requestId !== "string" || !requestId.trim()) throw new FalImageError("provider_unavailable");
  return { request_id: requestId.trim() };
}

export async function speechStatus(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalSpeechStatus> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${falSpeechQueueBase}/requests/${encodeURIComponent(requestId)}/status`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const state = body && typeof body === "object" && !Array.isArray(body)
    ? String((body as { status?: unknown }).status ?? "")
    : "";
  if (state === "IN_QUEUE" || state === "IN_PROGRESS") return { status: state };
  if (state === "COMPLETED") return { status: "COMPLETED" };
  if (state === "FAILED") return { status: "FAILED", failureCode: "unsafe_output" };
  throw new FalImageError("provider_unavailable");
}

function firstFalAudioUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.audio) return firstFalAudioUrl(record.audio);
  if (typeof record.url === "string") return record.url;
  return undefined;
}

export async function speechResult(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalSpeechResult> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${falSpeechQueueBase}/requests/${encodeURIComponent(requestId)}`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const url = firstFalAudioUrl(body);
  if (!url) throw new FalImageError("unsafe_output");
  assertFalMediaUrl(url);
  return { url };
}

export async function cancelSpeech(
  credential: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<void> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status } = await falJson(
    credential,
    `${falSpeechQueueBase}/requests/${encodeURIComponent(requestId)}/cancel`,
    { method: "PUT" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status === 404) return;
  if (!status.toString().startsWith("2") && status !== 409) {
    throw new FalImageError(classifyHttp(status));
  }
}

export interface CredentialVault {
  activeVersion: number;
  keys: ReadonlyMap<number, Uint8Array>;
}

export interface EncryptedCredential {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authTag: Uint8Array;
  keyVersion: number;
}

export interface CredentialIdentity {
  id: string;
  ownerId: string;
  provider: "fal" | "pexels";
}

export class FalProviderError extends Error {
  readonly name = "FalProviderError";

  constructor(readonly code: "credential" | "unavailable") {
    super(code === "credential" ? "provider credential rejected" : "provider unavailable");
  }
}

export async function validateFalCredential(
  credential: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000
): Promise<void> {
  try {
    await estimateImage(credential, fetchImpl, timeoutMs);
  } catch (error) {
    if (error instanceof FalImageError) {
      throw new FalProviderError(error.code === "credential" ? "credential" : "unavailable");
    }
    throw error;
  }
}


function positiveVersion(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("invalid credential key version");
  return value;
}

function decodeKey(value: string | undefined): Uint8Array {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("invalid credential encryption key");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error("invalid credential encryption key");
  }
  return decoded;
}

export function falByokEnabled(env: Record<string, string | undefined>): boolean {
  const value = env.FENGINE_FAL_BYOK_ENABLED;
  if (value === undefined || value === "0") return false;
  if (value !== "1") throw new Error("invalid FENGINE_FAL_BYOK_ENABLED");
  return true;
}

export function credentialVaultFromEnv(env: Record<string, string | undefined>): CredentialVault {
  const activeVersion = positiveVersion(env.FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION);
  const key = decodeKey(env[`FENGINE_CREDENTIAL_KEY_V${activeVersion}`]);
  return { activeVersion, keys: new Map([[activeVersion, key]]) };
}

export function assertNoSharedFalCredential(env: Record<string, string | undefined>): void {
  if ((env.FENGINE_ENV === "hosted" || env.NODE_ENV === "production")
    && (env.FAL_KEY !== undefined || env.FAL_API_KEY !== undefined)) {
    throw new Error("shared FAL credentials are forbidden in hosted mode");
  }
}

export function assertNoSharedPexelsCredential(env: Record<string, string | undefined>): void {
  if ((env.FENGINE_ENV === "hosted" || env.NODE_ENV === "production")
    && env.PEXELS_API_KEY !== undefined) {
    throw new Error("shared Pexels credentials are forbidden in hosted mode");
  }
}

function aad(identity: CredentialIdentity, keyVersion: number): Buffer {
  return Buffer.from(`${identity.id}\n${identity.ownerId}\n${identity.provider}\n${keyVersion}`, "utf8");
}

export function encryptCredential(
  plaintext: string,
  identity: CredentialIdentity,
  vault: CredentialVault
): EncryptedCredential {
  const key = vault.keys.get(vault.activeVersion);
  if (!key) throw new Error("credential encryption key unavailable");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(identity, vault.activeVersion));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext,
    nonce,
    authTag: cipher.getAuthTag(),
    keyVersion: vault.activeVersion
  };
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  identity: CredentialIdentity,
  vault: CredentialVault
): string {
  const key = vault.keys.get(encrypted.keyVersion);
  if (!key) throw new Error("credential encryption key unavailable");
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAAD(aad(identity, encrypted.keyVersion));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
}

export function normalizeProviderCredential(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid provider credential");
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error("invalid provider credential");
  }
  return normalized;
}

export function normalizeFalCredential(value: unknown): string {
  return normalizeProviderCredential(value);
}
