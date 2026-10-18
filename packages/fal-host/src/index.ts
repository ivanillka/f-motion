import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const falPricingUrl = "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai%2Fflux%2Fschnell";
export const FAL_IMAGE_ENDPOINT_ID = "fal-ai/flux/schnell";
const falEndpointId = FAL_IMAGE_ENDPOINT_ID;
/** Submitting keeps the whole endpoint id: POST https://queue.fal.run/fal-ai/flux/schnell. */
const falQueueSubmitUrl = `https://queue.fal.run/${FAL_IMAGE_ENDPOINT_ID}`;
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

/**
 * Queue routes for one request - status, result, and cancel - address the app pair only:
 * `https://queue.fal.run/{owner}/{alias}/requests/{id}`. The endpoint path after the alias
 * belongs to the submit URL; both FAL clients drop it when they rebuild a request URL
 * (@fal-ai/client `parseEndpointId`, fal_client `AppId.from_endpoint_id`), and queue.fal.run
 * answers a path-ful GET from the app runner with 405 instead of the queue.
 */
function falRequestBaseFor(endpointId: string): string {
  const [owner, alias] = endpointId.split("/");
  if (!owner || !alias) throw new FalImageError("invalid_request");
  return `https://queue.fal.run/${owner}/${alias}`;
}

/** Status, result, and cancel for one Flux still: GET .../fal-ai/flux/requests/{id}/status. */
const falImageRequestBase = falRequestBaseFor(FAL_IMAGE_ENDPOINT_ID);

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
  const { status, body } = await falJson(credential, falQueueSubmitUrl, {
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
    `${falImageRequestBase}/requests/${encodeURIComponent(requestId)}/status`,
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
    `${falImageRequestBase}/requests/${encodeURIComponent(requestId)}`,
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
    `${falImageRequestBase}/requests/${encodeURIComponent(requestId)}/cancel`,
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
const falVideoQueueSubmitUrl = `https://queue.fal.run/${FAL_VIDEO_ENDPOINT_ID}`;
/** Status, result, and cancel address the app pair only, without the endpoint path. */
const falVideoRequestBase = falRequestBaseFor(FAL_VIDEO_ENDPOINT_ID);
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
  const { status, body } = await falJson(credential, falVideoQueueSubmitUrl, {
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
    `${falVideoRequestBase}/requests/${encodeURIComponent(requestId)}/status`,
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
    `${falVideoRequestBase}/requests/${encodeURIComponent(requestId)}`,
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
    `${falVideoRequestBase}/requests/${encodeURIComponent(requestId)}/cancel`,
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
const falSpeechQueueSubmitUrl = `https://queue.fal.run/${FAL_SPEECH_ENDPOINT_ID}`;
/** Status, result, and cancel address the app pair only: GET .../fal-ai/kokoro/requests/{id}/status. */
const falSpeechRequestBase = falRequestBaseFor(FAL_SPEECH_ENDPOINT_ID);

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

/*
 * Speech diagnostics. A slow Kokoro take is otherwise invisible: the caller only
 * sees a FalImageError 60s later. The sink reports the queue status, the queue
 * position, the error fields, and how long the wait was.
 *
 * The FAL key, the signed take URL, and any field that looks like a credential
 * never reach the sink: bodies are copied through redactFalBody first.
 */
export type FalDiagnosticStage = "submit" | "status" | "result" | "download" | "timeout" | "failure";

export interface FalDiagnosticEvent {
  stage: FalDiagnosticStage;
  endpoint: string;
  requestId?: string;
  /** FAL queue state: IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED. */
  status?: string;
  /** Providers report the place in line while the request is queued. */
  queuePosition?: number;
  httpStatus?: number;
  contentType?: string;
  bytes?: number;
  code?: FalImageErrorCode;
  elapsedMs?: number;
  /** Redacted copy of the provider response. */
  body?: unknown;
}

export type FalDiagnosticSink = (event: FalDiagnosticEvent) => void;

let diagnosticSink: FalDiagnosticSink | undefined;

/** One sink per process, installed at startup. Unset keeps diagnostics silent. */
export function setFalDiagnosticSink(sink?: FalDiagnosticSink): void {
  diagnosticSink = sink;
}

export function emitFalDiagnostic(event: FalDiagnosticEvent): void {
  if (!diagnosticSink) return;
  try {
    diagnosticSink(event);
  } catch {
    // A diagnostic never breaks a voice line.
  }
}

const falSecretField = /(url|uri|signed|token|secret|authorization|key|password)/iu;

/** A URL keeps its host only; every other string is clipped. */
function redactFalString(value: string): string {
  if (!/^https?:\/\//iu.test(value)) return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  try {
    return `${new URL(value).host}/…`;
  } catch {
    return "(redacted)";
  }
}

/** Provider body copy with signed URLs, tokens, and keys stripped. */
export function redactFalBody(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactFalString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 4) return "(truncated)";
  if (Array.isArray(value)) return value.slice(0, 5).map((item) => redactFalBody(item, depth + 1));
  const redacted: Record<string, unknown> = {};
  for (const [field, item] of Object.entries(value as Record<string, unknown>)) {
    redacted[field] = falSecretField.test(field) ? "(redacted)" : redactFalBody(item, depth + 1);
  }
  return redacted;
}

/** Submitting, polling, and downloading one Kokoro line. FAL queues are busy. */
export const FAL_SPEECH_POLL_TIMEOUT_MS = 180_000;
/** Time between two status checks while the line is still queued. */
export const FAL_SPEECH_POLL_INTERVAL_MS = 1_000;

export async function submitSpeech(
  credential: string,
  input: { prompt: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<FalSpeechSubmitResult> {
  const payload = falSpeechInput(input.prompt);
  const { status, body } = await falJson(credential, falSpeechQueueSubmitUrl, {
    method: "POST",
    headers: {
      "X-Fal-Store-IO": "0",
      "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 3600 })
    },
    body: JSON.stringify(payload)
  }, fetchImpl, timeoutMs, signal);
  const failure = (code: FalImageErrorCode) => {
    emitFalDiagnostic({
      stage: "failure",
      endpoint: FAL_SPEECH_ENDPOINT_ID,
      httpStatus: status,
      code,
      body: redactFalBody(body)
    });
    return new FalImageError(code);
  };
  if (status === 401 || status === 403) throw failure("credential");
  if (status === 429) throw failure("rate_limited");
  if (status < 200 || status >= 300) throw failure(classifyHttp(status));
  const requestId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { request_id?: unknown }).request_id
    : undefined;
  if (typeof requestId !== "string" || !requestId.trim()) throw failure("provider_unavailable");
  emitFalDiagnostic({
    stage: "submit",
    endpoint: FAL_SPEECH_ENDPOINT_ID,
    requestId: requestId.trim(),
    httpStatus: status,
    body: redactFalBody(body)
  });
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
    `${falSpeechRequestBase}/requests/${encodeURIComponent(requestId)}/status`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
    signal
  );
  if (status === 401 || status === 403) throw new FalImageError("credential");
  if (status < 200 || status >= 300) throw new FalImageError(classifyHttp(status));
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : undefined;
  const state = String(record?.status ?? "");
  const queuePosition = typeof record?.queue_position === "number" && Number.isFinite(record.queue_position)
    ? record.queue_position
    : undefined;
  const diagnostic = (stage: FalDiagnosticStage, code?: FalImageErrorCode) => emitFalDiagnostic({
    stage,
    endpoint: FAL_SPEECH_ENDPOINT_ID,
    requestId,
    status: state || "(empty)",
    ...(queuePosition === undefined ? {} : { queuePosition }),
    httpStatus: status,
    ...(code ? { code } : {}),
    body: redactFalBody(body)
  });
  if (state === "IN_QUEUE" || state === "IN_PROGRESS") {
    diagnostic("status");
    return { status: state };
  }
  if (state === "COMPLETED") {
    diagnostic("status");
    return { status: "COMPLETED" };
  }
  if (state === "FAILED") {
    diagnostic("failure", "unsafe_output");
    return { status: "FAILED", failureCode: "unsafe_output" };
  }
  diagnostic("failure", "provider_unavailable");
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
    `${falSpeechRequestBase}/requests/${encodeURIComponent(requestId)}`,
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
  emitFalDiagnostic({
    stage: "result",
    endpoint: FAL_SPEECH_ENDPOINT_ID,
    requestId,
    httpStatus: status,
    body: redactFalBody(body)
  });
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
    `${falSpeechRequestBase}/requests/${encodeURIComponent(requestId)}/cancel`,
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

const falSpeechRedirectLimit = 5;

/** A take is only audio. Anything else is a provider mistake, not a voice. */
function checkFalSpeechAudio(response: Response): Response {
  if (!response.ok) throw new FalImageError("provider_unavailable");
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (type && !type.startsWith("audio/") && !type.startsWith("application/octet-stream")) {
    throw new FalImageError("unsafe_output");
  }
  const declared = Number(response.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > FAL_SPEECH_MAX_BYTES) throw new FalImageError("unsafe_output");
  if (!response.body) throw new FalImageError("provider_unavailable");
  return response;
}

/**
 * One audio take from the signed FAL URL in a speech result. Redirects are
 * followed by hand and every hop is re-checked against the FAL media hosts, so a
 * signed URL cannot bounce the download to another origin. The caller reads the
 * body; the size ceiling is enforced here and by FAL_SPEECH_MAX_BYTES.
 */
export async function fetchFalSpeechAudio(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = falHttpTimeoutMs,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref();
  try {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      assertFalMediaUrl(current);
      let response: Response;
      try {
        response = await fetchImpl(current, { method: "GET", redirect: "manual", signal: controller.signal });
      } catch {
        throw new FalImageError("provider_unavailable");
      }
      const location = response.status >= 300 && response.status < 400
        ? response.headers.get("location")
        : null;
      if (!location) return checkFalSpeechAudio(response);
      if (hop >= falSpeechRedirectLimit) throw new FalImageError("unsafe_output");
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new FalImageError("unsafe_output");
      }
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function isWavHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;
}

/**
 * One Kokoro line. The prompt is that line, voice af_heart, speed 1.
 * The bytes are the take. Fitting them to a scene happens after this returns.
 *
 * FAL queues are shared, so a line that used to finish in seconds can sit in
 * IN_QUEUE for minutes. The wait is FAL_SPEECH_POLL_TIMEOUT_MS, and the sink
 * reports the queue state, the place in line, and the wait before the caller
 * gives up.
 */
export async function speakKokoroLine(
  credential: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = FAL_SPEECH_POLL_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const startedAt = Date.now();
  const submitted = await submitSpeech(credential, { prompt: text }, fetchImpl, timeoutMs, signal);
  const deadline = Date.now() + timeoutMs;
  let completed = false;
  let lastStatus = "IN_QUEUE";
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new FalImageError("provider_unavailable");
    const status = await speechStatus(credential, submitted.request_id, fetchImpl, timeoutMs, signal);
    if (status.status === "FAILED") throw new FalImageError(status.failureCode);
    lastStatus = status.status;
    if (status.status === "COMPLETED") {
      completed = true;
      break;
    }
    const wait = Math.min(FAL_SPEECH_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
    if (wait === 0) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (!completed) {
    emitFalDiagnostic({
      stage: "timeout",
      endpoint: FAL_SPEECH_ENDPOINT_ID,
      requestId: submitted.request_id,
      status: lastStatus,
      code: "provider_unavailable",
      elapsedMs: Date.now() - startedAt
    });
    throw new FalImageError("provider_unavailable");
  }
  const result = await speechResult(credential, submitted.request_id, fetchImpl, timeoutMs, signal);
  const audio = await fetchFalSpeechAudio(result.url, fetchImpl, timeoutMs, signal);
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > FAL_SPEECH_MAX_BYTES || !isWavHeader(bytes)) {
    emitFalDiagnostic({
      stage: "failure",
      endpoint: FAL_SPEECH_ENDPOINT_ID,
      requestId: submitted.request_id,
      code: "unsafe_output",
      bytes: bytes.byteLength,
      elapsedMs: Date.now() - startedAt
    });
    throw new FalImageError("unsafe_output");
  }
  emitFalDiagnostic({
    stage: "download",
    endpoint: FAL_SPEECH_ENDPOINT_ID,
    requestId: submitted.request_id,
    contentType: audio.headers.get("content-type") ?? undefined,
    bytes: bytes.byteLength,
    elapsedMs: Date.now() - startedAt
  });
  return bytes;
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
  provider: "fal" | "pexels" | "civitai";
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

export function assertNoSharedCivitaiCredential(env: Record<string, string | undefined>): void {
  if ((env.FENGINE_ENV === "hosted" || env.NODE_ENV === "production")
    && env.CIVITAI_API_KEY !== undefined) {
    throw new Error("shared Civitai credentials are forbidden in hosted mode");
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
