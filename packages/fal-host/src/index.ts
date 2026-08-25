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
/** Contract checked 2026-08-20: fal.ai model-arguments lists portrait_16_9 as 576×1024. */
export const FAL_IMAGE_SIZE = "portrait_16_9" as const;
export const FAL_IMAGE_WIDTH = 576;
export const FAL_IMAGE_HEIGHT = 1024;
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
  /** Honest total for the pinned one-still request; null when the unit cannot be mapped. */
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
  const perImage = unit === "image" || unit === "images" || unit === "request" || unit === "requests";
  const perMegapixel = unit === "megapixel" || unit === "megapixels";
  // FAL bills Flux Schnell by rounding pixels up to the next megapixel.
  const billedMegapixels = Math.ceil((FAL_IMAGE_WIDTH * FAL_IMAGE_HEIGHT) / 1_000_000);
  const estimated_total = perImage ? match.unit_price
    : perMegapixel ? match.unit_price * billedMegapixels
      : null;
  return {
    endpoint_id: match.endpoint_id,
    unit_price: match.unit_price,
    unit: match.unit,
    currency: match.currency,
    estimated_total,
    ...(estimated_total === null ? {
      estimated_total_explanation: `FAL bills this model per ${match.unit}; a fixed dollar total is not computed for one still.`
    } : {})
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
    image_size: FAL_IMAGE_SIZE,
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
  // Honest 6s total only when the unit is clearly one pinned Hailuo clip.
  // FAL sometimes labels the same per-clip rate as "units" instead of "video".
  const perSixSecond = unit === "video" || unit === "videos" || unit === "unit" || unit === "units"
    || unit === "request" || unit === "requests"
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

/** Contract checked 2026-08-25: GET /v1/account/billing is ADMIN-scoped. API-scope keys 401/403. */
const falBillingUrl = "https://api.fal.ai/v1/account/billing?expand=credits";

export type FalCreditsUnavailable = "admin_key_required" | "provider_unavailable";

export interface FalAccountView {
  username?: string;
  credits?: { current_balance: number; currency: string };
  credits_unavailable?: FalCreditsUnavailable;
}

function asUsername(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const username = value.trim();
  if (!username || username.length > 64 || /[\u0000-\u001f\u007f]/.test(username)) return undefined;
  return username;
}

export function parseFalAccount(status: number, body: unknown): FalAccountView {
  if (status === 401 || status === 403) return { credits_unavailable: "admin_key_required" };
  if (status < 200 || status >= 300 || !body || typeof body !== "object" || Array.isArray(body)) {
    return { credits_unavailable: "provider_unavailable" };
  }
  const record = body as Record<string, unknown>;
  const username = asUsername(record.username);
  const credits = record.credits && typeof record.credits === "object" && !Array.isArray(record.credits)
    ? record.credits as Record<string, unknown>
    : undefined;
  const current_balance = credits && typeof credits.current_balance === "number" && Number.isFinite(credits.current_balance)
    && credits.current_balance >= 0
    ? credits.current_balance
    : undefined;
  const currency = credits && typeof credits.currency === "string" && /^[A-Z]{3}$/.test(credits.currency)
    ? credits.currency
    : undefined;
  if (current_balance === undefined || !currency) {
    return {
      ...(username ? { username } : {}),
      credits_unavailable: "provider_unavailable"
    };
  }
  return {
    ...(username ? { username } : {}),
    credits: { current_balance, currency }
  };
}

export async function fetchAccount(
  credential: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalAccountView> {
  try {
    const { status, body } = await falJson(credential, falBillingUrl, { method: "GET" }, fetchImpl, timeoutMs, signal);
    return parseFalAccount(status, body);
  } catch (error) {
    if (error instanceof FalImageError && error.code === "credential") {
      return { credits_unavailable: "admin_key_required" };
    }
    return { credits_unavailable: "provider_unavailable" };
  }
}

/** Contract checked 2026-08-25 against fal.ai Moondream 3 query + video-understanding docs. */
export const FAL_STILL_ANALYZE_ENDPOINT_ID = "fal-ai/moondream3-preview/query";
export const FAL_VIDEO_ANALYZE_ENDPOINT_ID = "fal-ai/video-understanding";
export const FAL_ANALYZE_STILL_PROMPT =
  "Describe this still for a vertical reel. Reply with JSON only: {\"visual_prompt\":\"...\",\"caption\":\"...\"}. visual_prompt is a factual visual description, max 220 characters. caption is the on-screen line, max 160 characters. Do not invent people, brands, or text that is not visible.";
export const FAL_ANALYZE_VIDEO_PROMPT =
  "Describe this footage for a vertical reel. Reply with JSON only: {\"visual_prompt\":\"...\",\"caption\":\"...\"}. visual_prompt is a factual description of what happens, max 220 characters. caption is the on-screen line, max 160 characters. Do not invent people, brands, or text that is not visible.";
const falStillAnalyzePricingUrl =
  "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fmoondream3-preview%2Fquery";
const falVideoAnalyzePricingUrl =
  "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fvideo-understanding";

export type FalAnalyzeQuote = FalImageQuote;
export type FalAnalyzeSubmitResult = FalImageSubmitResult;
export type FalAnalyzeStatus = FalImageStatus;
export interface FalAnalyzeResult {
  output: string;
}

export interface FalStoryFromMedia {
  visual_prompt: string;
  caption: string;
}

function clipStoryField(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  const sliced = compact.slice(0, max);
  const boundary = sliced.lastIndexOf(" ");
  return (boundary >= 40 ? sliced.slice(0, boundary) : sliced).trim();
}

export function parseStoryFromAnalysis(raw: string): FalStoryFromMedia {
  const trimmed = raw.trim();
  if (!trimmed) throw new FalImageError("unsafe_output");
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const visual = typeof record.visual_prompt === "string" ? record.visual_prompt : "";
        const caption = typeof record.caption === "string" ? record.caption : "";
        const visual_prompt = clipStoryField(visual, 240);
        const line = clipStoryField(caption || visual, 180);
        if (visual_prompt && line) return { visual_prompt, caption: line };
      }
    } catch {
      // Fall through to plain-text clipping.
    }
  }
  const visual_prompt = clipStoryField(trimmed, 240);
  const caption = clipStoryField(trimmed.split(/(?<=[.!?])\s/)[0] ?? trimmed, 180);
  if (!visual_prompt || !caption) throw new FalImageError("unsafe_output");
  return { visual_prompt, caption };
}

function pickEndpointPrice(
  body: unknown,
  endpointId: string,
  estimatedTotal: (unit: string, unitPrice: number) => number | null
): FalAnalyzeQuote {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FalImageError("provider_unavailable");
  }
  const prices = (body as { prices?: unknown }).prices;
  if (!Array.isArray(prices)) throw new FalImageError("provider_unavailable");
  const match = prices.find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const price = item as Record<string, unknown>;
    return price.endpoint_id === endpointId
      && typeof price.unit_price === "number"
      && Number.isFinite(price.unit_price)
      && price.unit_price >= 0
      && typeof price.unit === "string"
      && typeof price.currency === "string";
  }) as { endpoint_id: string; unit_price: number; unit: string; currency: string } | undefined;
  if (!match) throw new FalImageError("provider_unavailable");
  const estimated_total = estimatedTotal(match.unit.toLowerCase(), match.unit_price);
  return {
    endpoint_id: match.endpoint_id,
    unit_price: match.unit_price,
    unit: match.unit,
    currency: match.currency,
    estimated_total,
    ...(estimated_total === null ? {
      estimated_total_explanation: `FAL bills this model per ${match.unit}; a fixed dollar total is not computed for this analysis.`
    } : {})
  };
}

export async function estimateStillAnalysis(
  credential: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalAnalyzeQuote> {
  const { status, body } = await falJson(credential, falStillAnalyzePricingUrl, { method: "GET" }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  return pickEndpointPrice(body, FAL_STILL_ANALYZE_ENDPOINT_ID, (unit, unitPrice) => {
    const perRequest = unit === "request" || unit === "requests" || unit === "image" || unit === "images"
      || unit === "unit" || unit === "units";
    return perRequest ? unitPrice : null;
  });
}

export function videoAnalysisBillableUnits(durationMs: number): number {
  if (!Number.isInteger(durationMs) || durationMs < 500) throw new FalImageError("invalid_request");
  return Math.max(1, Math.ceil(durationMs / 5_000));
}

export async function estimateVideoAnalysis(
  credential: string,
  durationMs: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalAnalyzeQuote> {
  const units = videoAnalysisBillableUnits(durationMs);
  const { status, body } = await falJson(credential, falVideoAnalyzePricingUrl, { method: "GET" }, fetchImpl, timeoutMs, signal);
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  return pickEndpointPrice(body, FAL_VIDEO_ANALYZE_ENDPOINT_ID, (unit, unitPrice) => {
    const perRequest = unit === "request" || unit === "requests" || unit === "video" || unit === "videos"
      || unit === "unit" || unit === "units";
    const perFiveSeconds = unit.includes("5") && unit.includes("second");
    const perSecond = (unit === "second" || unit === "seconds") && !perFiveSeconds;
    if (perFiveSeconds) return unitPrice * units;
    if (perSecond) return unitPrice * Math.max(1, Math.ceil(durationMs / 1000));
    if (perRequest) return unitPrice;
    return null;
  });
}

export function falStillAnalyzeInput(imageUrl: string): Record<string, unknown> {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
    throw new FalImageError("invalid_request");
  }
  return { image_url: imageUrl, prompt: FAL_ANALYZE_STILL_PROMPT, reasoning: false };
}

export function falVideoAnalyzeInput(videoUrl: string): Record<string, unknown> {
  if (typeof videoUrl !== "string" || !videoUrl.startsWith("https://")) {
    throw new FalImageError("invalid_request");
  }
  return { video_url: videoUrl, prompt: FAL_ANALYZE_VIDEO_PROMPT, detailed_analysis: false };
}

function analyzeQueueBase(endpointId: string): string {
  if (endpointId !== FAL_STILL_ANALYZE_ENDPOINT_ID && endpointId !== FAL_VIDEO_ANALYZE_ENDPOINT_ID) {
    throw new FalImageError("invalid_request");
  }
  return `https://queue.fal.run/${endpointId}`;
}

export async function submitAnalyze(
  credential: string,
  endpointId: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalAnalyzeSubmitResult> {
  const { status, body } = await falJson(credential, analyzeQueueBase(endpointId), {
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

export async function analyzeStatus(
  credential: string,
  endpointId: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalAnalyzeStatus> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${analyzeQueueBase(endpointId)}/requests/${encodeURIComponent(requestId)}/status`,
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

function analyzeOutput(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.output === "string") return record.output;
  return undefined;
}

export async function analyzeResult(
  credential: string,
  endpointId: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalAnalyzeResult> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status, body } = await falJson(
    credential,
    `${analyzeQueueBase(endpointId)}/requests/${encodeURIComponent(requestId)}`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const output = analyzeOutput(body);
  if (typeof output !== "string" || !output.trim()) throw new FalImageError("unsafe_output");
  return { output: output.trim() };
}

export async function cancelAnalyze(
  credential: string,
  endpointId: string,
  requestId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<void> {
  if (!requestId.trim()) throw new FalImageError("invalid_request");
  const { status } = await falJson(
    credential,
    `${analyzeQueueBase(endpointId)}/requests/${encodeURIComponent(requestId)}/cancel`,
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
