import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import {
  maximumMediaBytes,
  resolveImportedMediaType,
  sealImportedStillFromObject,
  spoolBoundedBody,
  type PostgresMediaRepository,
  type PrivateObjectStore,
  type StoredMedia
} from "./media-storage.js";

export const civitaiNsfwLevels = ["None", "Soft", "Mature", "X"] as const;
export type CivitaiNsfwLevel = (typeof civitaiNsfwLevels)[number];

export const civitaiSorts = [
  "Most Reactions", "Most Comments", "Most Collected", "Newest", "Oldest", "Random"
] as const;
export type CivitaiSort = (typeof civitaiSorts)[number];

export const civitaiPeriods = ["AllTime", "Year", "Month", "Week", "Day"] as const;
export type CivitaiPeriod = (typeof civitaiPeriods)[number];

const civitaiBrowsingCap: Record<CivitaiNsfwLevel, number> = {
  None: 1,
  Soft: 2,
  Mature: 4,
  X: 8
};

export function civitaiLevelRank(level: CivitaiNsfwLevel): number {
  return civitaiNsfwLevels.indexOf(level);
}

function civitaiBrowsingLevel(level: CivitaiNsfwLevel): number {
  return (1 << (civitaiLevelRank(level) + 1)) - 1;
}

export const defaultCivitaiMediaHosts = [
  "image.civitai.com",
  "blobs.civitai.com",
  "blobs-b2.civitai.com"
] as const;

export interface CivitaiPolicy {
  nsfwLevel: CivitaiNsfwLevel;
  allowedMediaHosts: ReadonlySet<string>;
  allowedCreators?: readonly string[];
  minShortSide?: number;
}

export const defaultCivitaiPolicy: CivitaiPolicy = {
  nsfwLevel: "None",
  allowedMediaHosts: new Set(defaultCivitaiMediaHosts),
  minShortSide: 1080
};

export function civitaiPolicyFromEnv(env: Record<string, string | undefined>): CivitaiPolicy {
  const rawLevel = env.FENGINE_CIVITAI_NSFW_LEVEL?.trim() || "None";
  if (!civitaiNsfwLevels.includes(rawLevel as CivitaiNsfwLevel)) {
    throw new Error("invalid FENGINE_CIVITAI_NSFW_LEVEL");
  }
  const rawHosts = env.FENGINE_CIVITAI_ALLOWED_MEDIA_HOSTS?.trim();
  const hosts = rawHosts === undefined
    ? [...defaultCivitaiMediaHosts]
    : rawHosts.split(",").map((host) => host.trim()).filter(Boolean);
  if (!hosts.length) throw new Error("invalid FENGINE_CIVITAI_ALLOWED_MEDIA_HOSTS");
  for (const host of hosts) {
    try {
      if (new URL(`https://${host}`).hostname !== host) throw new Error("invalid host");
    } catch {
      throw new Error("invalid FENGINE_CIVITAI_ALLOWED_MEDIA_HOSTS");
    }
  }
  return {
    nsfwLevel: rawLevel as CivitaiNsfwLevel,
    allowedMediaHosts: new Set(hosts),
    minShortSide: 1080
  };
}

export function civitaiUrlAllowed(url: string, hosts: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && hosts.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function civitaiAttributionUrlAllowed(
  url: string,
  kind: "images" | "posts",
  id: number
): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "civitai.com"
      && !parsed.username
      && !parsed.password
      && parsed.pathname === `/${kind}/${id}`;
  } catch {
    return false;
  }
}

export interface CivitaiResult {
  id: number;
  creator: string;
  attributionUrl: string;
  postId: number;
  postUrl: string;
  previewUrl: string;
  sourceUrl: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  nsfwLevel: CivitaiNsfwLevel;
  browsingLevel: number;
  baseModel?: string;
  prompt?: string;
}

export interface CivitaiSearchInput {
  query?: string;
  username?: string;
  sort?: CivitaiSort;
  period?: CivitaiPeriod;
  cursor?: string;
  limit?: number;
  orientation?: "portrait" | "landscape";
  modelId?: number;
}

export interface CivitaiSearchPage {
  results: CivitaiResult[];
  nextCursor?: string;
  modelId?: number;
}

export class CivitaiRequestError extends Error {
  readonly name = "CivitaiRequestError";
  constructor() { super("Civitai unavailable"); }
}

interface CivitaiImageItem {
  id?: unknown;
  url?: unknown;
  width?: unknown;
  height?: unknown;
  nsfwLevel?: unknown;
  browsingLevel?: unknown;
  type?: unknown;
  username?: unknown;
  baseModel?: unknown;
  postId?: unknown;
  meta?: unknown;
}

interface CivitaiImagesBody {
  items?: CivitaiImageItem[];
  metadata?: { nextCursor?: unknown; nextPage?: unknown };
}

interface CivitaiModelsBody {
  items?: Array<{ id?: unknown }>;
  metadata?: { nextCursor?: unknown };
}

function imageContentType(url: URL): CivitaiResult["contentType"] {
  if (url.pathname.endsWith(".png")) return "image/png";
  if (url.pathname.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function resizedImageUrl(url: URL, width: number): string {
  const path = url.pathname.replace("/original=true", `/width=${width}`);
  return new URL(path + url.search + url.hash, url).toString();
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function textValue(value: unknown, max = 200): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

export class CivitaiClient {
  constructor(
    readonly apiKey: string | undefined,
    readonly policy: CivitaiPolicy = defaultCivitaiPolicy,
    readonly request: typeof fetch = fetch,
    readonly copyDeadlineMs = 30_000,
    readonly temporaryRoot = tmpdir()
  ) {}

  private headers(contentType?: "json"): Record<string, string> {
    return {
      accept: "application/json",
      ...(contentType === "json" ? { "content-type": "application/json" } : {}),
      ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
    };
  }

  private accepts(item: CivitaiImageItem, orientation: "portrait" | "landscape"): CivitaiResult | undefined {
    if (item.type !== "image") return undefined;
    const id = numberValue(item.id);
    const width = numberValue(item.width);
    const height = numberValue(item.height);
    const postId = numberValue(item.postId);
    const browsingLevel = numberValue(item.browsingLevel);
    if (!id || !width || !height || !postId || !browsingLevel) return undefined;
    const minShortSide = Math.max(0, this.policy.minShortSide ?? 1080);
    if (Math.min(width, height) < minShortSide) return undefined;
    if (orientation === "portrait" ? height < width : width < height) return undefined;
    const level = civitaiNsfwLevels.find((candidate) => candidate === item.nsfwLevel);
    if (!level || civitaiLevelRank(level) > civitaiLevelRank(this.policy.nsfwLevel)) return undefined;
    if (browsingLevel > civitaiBrowsingCap[this.policy.nsfwLevel]) return undefined;
    if (typeof item.url !== "string" || !civitaiUrlAllowed(item.url, this.policy.allowedMediaHosts)) return undefined;
    const sourceUrl = resizedImageUrl(new URL(item.url), 1280);
    const previewUrl = resizedImageUrl(new URL(item.url), 450);
    if (!civitaiUrlAllowed(sourceUrl, this.policy.allowedMediaHosts)
      || !civitaiUrlAllowed(previewUrl, this.policy.allowedMediaHosts)) return undefined;
    const creator = textValue(item.username);
    if (!creator) return undefined;
    const allowedCreators = this.policy.allowedCreators?.map((name) => name.toLowerCase());
    if (allowedCreators?.length && !allowedCreators.includes(creator.toLowerCase())) return undefined;
    let metaPrompt: string | undefined;
    if (item.meta && typeof item.meta === "object" && !Array.isArray(item.meta)) {
      const prompt = (item.meta as Record<string, unknown>).prompt;
      if (typeof prompt === "string") metaPrompt = prompt.trim();
    }
    const baseModel = textValue(item.baseModel);
    return {
      id,
      creator,
      attributionUrl: `https://civitai.com/images/${id}`,
      postId,
      postUrl: `https://civitai.com/posts/${postId}`,
      previewUrl,
      sourceUrl,
      contentType: imageContentType(new URL(item.url)),
      width,
      height,
      nsfwLevel: level,
      browsingLevel,
      ...(baseModel ? { baseModel } : {}),
      ...(metaPrompt ? { prompt: metaPrompt } : {})
    };
  }

  private async json<T>(url: string): Promise<T> {
    const response = await this.request(url, { headers: this.headers() });
    if (!response.ok) throw new CivitaiRequestError();
    try {
      return await response.json() as T;
    } catch {
      throw new CivitaiRequestError();
    }
  }

  private async modelIds(query: string): Promise<number[]> {
    const params = new URLSearchParams({
      query,
      limit: "8",
      nsfw: civitaiLevelRank(this.policy.nsfwLevel) > 0 ? "true" : "false"
    });
    const body = await this.json<CivitaiModelsBody>(`https://civitai.com/api/v1/models?${params.toString()}`);
    return (body.items ?? []).flatMap((item) => {
      const id = numberValue(item.id);
      return id ? [id] : [];
    });
  }

  private async images(
    input: CivitaiSearchInput,
    modelId: number | undefined
  ): Promise<CivitaiSearchPage> {
    const limit = Math.min(50, Math.max(1, Math.trunc(input.limit ?? 12)));
    const params = new URLSearchParams({
      limit: String(limit),
      sort: input.sort && civitaiSorts.includes(input.sort) ? input.sort : "Most Reactions",
      period: input.period && civitaiPeriods.includes(input.period) ? input.period : "Month",
      browsingLevel: String(civitaiBrowsingLevel(this.policy.nsfwLevel)),
      type: "image",
      withMeta: "true"
    });
    if (input.username) params.set("username", input.username);
    if (input.cursor) params.set("cursor", input.cursor);
    if (modelId) params.set("modelId", String(modelId));
    const body = await this.json<CivitaiImagesBody>(`https://civitai.com/api/v1/images?${params.toString()}`);
    const orientation = input.orientation ?? "portrait";
    const nextCursor = typeof body.metadata?.nextCursor === "string" ? body.metadata.nextCursor : undefined;
    return {
      results: (body.items ?? []).flatMap((item) => {
        const result = this.accepts(item, orientation);
        if (!result) return [];
        if (input.username && result.creator.toLowerCase() !== input.username.toLowerCase()) return [];
        return [result];
      }),
      ...(nextCursor ? { nextCursor } : {}),
      ...(modelId ? { modelId } : {})
    };
  }

  async imageById(id: number, orientation: "portrait" | "landscape" = "portrait"): Promise<CivitaiResult | undefined> {
    const params = new URLSearchParams({
      imageId: String(id),
      limit: "1",
      withMeta: "true",
      browsingLevel: String(civitaiBrowsingLevel(this.policy.nsfwLevel))
    });
    const body = await this.json<CivitaiImagesBody>(`https://civitai.com/api/v1/images?${params.toString()}`);
    return (body.items ?? []).flatMap((item) => {
      const result = this.accepts(item, orientation);
      return result ? [result] : [];
    })[0];
  }

  async search(
    input: string | CivitaiSearchInput,
    orientation: "portrait" | "landscape" = "portrait",
    cursor?: string
  ): Promise<CivitaiSearchPage> {
    const options: CivitaiSearchInput = typeof input === "string"
      ? { query: input, orientation, ...(cursor ? { cursor } : {}) }
      : input;
    if (!options.query) return this.images(options, options.modelId);
    if (options.cursor && options.modelId) return this.images(options, options.modelId);
    const modelIds = await this.modelIds(options.query);
    if (!modelIds.length) return { results: [] };
    let last: CivitaiSearchPage | undefined;
    for (const modelId of modelIds) {
      const page = await this.images(options, modelId);
      last = page;
      if (page.results.length || page.nextCursor) return page;
    }
    return last ?? { results: [] };
  }


  private async downloadAllowed(url: string, signal: AbortSignal): Promise<Response> {
    let current = url;
    for (let hop = 0; hop < 5; hop += 1) {
      if (!civitaiUrlAllowed(current, this.policy.allowedMediaHosts)) {
        throw new Error("Civitai media origin is not allowed");
      }
      const response = await this.request(current, {
        redirect: "manual",
        signal,
        headers: { accept: "image/jpeg,image/png,image/webp,*/*;q=0.8" }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (response.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
        if (!location) throw new CivitaiRequestError();
        current = new URL(location, current).toString();
        continue;
      }
      if (!response.ok) throw new CivitaiRequestError();
      return response;
    }
    throw new Error("Civitai media redirected too many times");
  }

  async copy(
    ownerId: string,
    projectId: string,
    selected: CivitaiResult,
    repository: PostgresMediaRepository,
    store: PrivateObjectStore
  ): Promise<StoredMedia> {
    const creator = selected.creator.trim();
    const allowedCreators = this.policy.allowedCreators?.map((name) => name.toLowerCase());
    if (!creator || creator.length > 200
      || civitaiLevelRank(selected.nsfwLevel) > civitaiLevelRank(this.policy.nsfwLevel)
      || selected.browsingLevel > civitaiBrowsingCap[this.policy.nsfwLevel]
      || Math.min(selected.width, selected.height) < Math.max(0, this.policy.minShortSide ?? 1080)
      || (allowedCreators?.length && !allowedCreators.includes(creator.toLowerCase()))
      || !civitaiAttributionUrlAllowed(selected.attributionUrl, "images", selected.id)
      || !civitaiAttributionUrlAllowed(selected.postUrl, "posts", selected.postId)
      || !civitaiUrlAllowed(selected.previewUrl, this.policy.allowedMediaHosts)
      || !civitaiUrlAllowed(selected.sourceUrl, this.policy.allowedMediaHosts)) {
      throw new Error("Civitai metadata rejected");
    }
    const directory = await mkdtemp(join(this.temporaryRoot, "fengine-civitai-"));
    const path = join(directory, "media");
    const controller = new AbortController();
    // Keep the deadline timer referenced so short copies still abort under an idle event loop.
    const timeout = setTimeout(() => controller.abort(), this.copyDeadlineMs);
    let response: Response | undefined;
    try {
      response = await this.downloadAllowed(selected.sourceUrl, controller.signal);
      const bytes = await spoolBoundedBody(response, path, maximumMediaBytes, controller.signal)
        .catch(() => { throw new Error("Civitai media body rejected"); });
      const prefix = await readFilePrefix(path, 16);
      const declaredType = resolveImportedMediaType(response.headers.get("content-type"), prefix);
      const id = randomUUID();
      const asset: StoredMedia = {
        id,
        ownerId,
        projectId,
        quarantineObjectKey: `projects/${projectId}/media-quarantine/${id}`,
        state: "admitted",
        declaredType,
        maxBytes: bytes,
        attribution: {
          source: "Civitai",
          creator,
          url: selected.attributionUrl,
          previewUrl: selected.previewUrl,
          postId: selected.postId,
          postUrl: selected.postUrl
        }
      };
      const upload = createReadStream(path);
      try {
        await store.put(asset.quarantineObjectKey, upload, declaredType, bytes);
      } finally {
        upload.destroy();
        await finished(upload).catch(() => undefined);
      }
      await repository.insert(asset);
      return sealImportedStillFromObject(
        ownerId,
        projectId,
        id,
        declaredType,
        asset.quarantineObjectKey,
        bytes,
        store,
        repository,
        { width: selected.width, height: selected.height }
      );
    } finally {
      clearTimeout(timeout);
      controller.abort();
      if (response?.body && !response.body.locked) {
        await response.body.cancel().catch(() => undefined);
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function readFilePrefix(path: string, maxBytes: number): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}


export interface CivitaiImageTextScorer {
  score(input: { imageId: number; imageUrl: string; text: string }): Promise<number>;
}

export interface CivitaiEmbeddingCache {
  get(imageId: number): Promise<number[] | undefined>;
  set(imageId: number, embedding: readonly number[]): Promise<void>;
}

export class MemoryCivitaiEmbeddingCache implements CivitaiEmbeddingCache {
  private readonly values = new Map<number, number[]>();

  constructor(readonly maxEntries = 500) {}

  async get(imageId: number): Promise<number[] | undefined> {
    const value = this.values.get(imageId);
    if (!value) return undefined;
    this.values.delete(imageId);
    this.values.set(imageId, value);
    return value;
  }

  async set(imageId: number, embedding: readonly number[]): Promise<void> {
    if (!embedding.length) return;
    this.values.delete(imageId);
    this.values.set(imageId, [...embedding]);
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
}

function vectorValue(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const vector = value.map(Number);
  return vector.every(Number.isFinite) ? vector : undefined;
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! * left[index]!;
    rightNorm += right[index]! * right[index]!;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export class FalClipScorer implements CivitaiImageTextScorer {
  constructor(
    readonly apiKey: string,
    readonly request: typeof fetch = fetch,
    readonly cache: CivitaiEmbeddingCache = new MemoryCivitaiEmbeddingCache(),
    readonly endpoint = "fal-ai/clip"
  ) {}

  private async call(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.request(`https://fal.run/${this.endpoint}`, {
      method: "POST",
      headers: { authorization: `Key ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) throw new Error("FAL CLIP unavailable");
    const body = await response.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("FAL CLIP response rejected");
    return body as Record<string, unknown>;
  }

  async score(input: { imageId: number; imageUrl: string; text: string }): Promise<number> {
    let imageEmbedding = await this.cache.get(input.imageId);
    const body = await this.call({
      prompt: input.text,
      image_url: input.imageUrl,
      ...(imageEmbedding ? { image_embedding: imageEmbedding } : {})
    });
    const direct = Number(body.score ?? body.similarity);
    if (Number.isFinite(direct)) return direct;
    const embeddings = body.embeddings && typeof body.embeddings === "object" && !Array.isArray(body.embeddings)
      ? body.embeddings as Record<string, unknown>
      : {};
    const returnedImage = vectorValue(body.image_embedding ?? body.imageEmbedding ?? embeddings.image);
    const textEmbedding = vectorValue(body.text_embedding ?? body.textEmbedding ?? embeddings.text);
    if (returnedImage && !imageEmbedding) {
      imageEmbedding = returnedImage;
      await this.cache.set(input.imageId, returnedImage);
    }
    if (!imageEmbedding || !textEmbedding) throw new Error("FAL CLIP embeddings missing");
    return cosine(imageEmbedding, textEmbedding);
  }
}

export interface CivitaiRankedResult extends CivitaiResult {
  fit: number;
  score_source: "image_text" | "text_fallback";
}

export function civitaiTextFitScore(intent_tokens: readonly string[], text: string): number {
  if (!intent_tokens.length) return 50;
  const intent = new Set(intent_tokens);
  const words = text.toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  let matched = 0;
  for (const word of words) {
    if (intent.has(word)) matched += 1;
  }
  return Math.min(100, Math.round((matched / intent_tokens.length) * 100));
}


function clampFit(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

async function scoreWithTimeout(
  scorer: CivitaiImageTextScorer,
  input: { imageId: number; imageUrl: string; text: string },
  timeoutMs: number
): Promise<number | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      scorer.score(input),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      })
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeImageScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return score > 1 ? score : score * 100;
}

export async function rankCivitaiResults(
  results: readonly CivitaiResult[],
  intent_tokens: readonly string[],
  query: string,
  scorer?: CivitaiImageTextScorer,
  scorerTimeoutMs = 1_500
): Promise<CivitaiRankedResult[]> {
  const texts = results.map((result, index) => {
    const text = [result.prompt, result.baseModel, result.creator].filter(Boolean).join(" ");
    const textFit = civitaiTextFitScore(intent_tokens, `${query} ${text}`);
    const apiFit = Math.round(50 * (1 - index / Math.max(1, results.length)));
    return { result, textFit, apiFit };
  });

  let imageScores: Array<number | undefined> = [];
  if (scorer && texts.length) {
    imageScores = await Promise.all(texts.map(({ result }) =>
      scoreWithTimeout(scorer, { imageId: result.id, imageUrl: result.previewUrl, text: query }, scorerTimeoutMs)));
  }

  return texts
    .map(({ result, textFit, apiFit }, index) => {
      const imageScore = imageScores[index];
      if (imageScore === undefined) {
        return {
          ...result,
          fit: clampFit(Math.max(textFit, apiFit)),
          score_source: "text_fallback" as const
        };
      }
      return {
        ...result,
        fit: clampFit(0.65 * normalizeImageScore(imageScore) + 0.35 * textFit),
        score_source: "image_text" as const
      };
    })
    .sort((left, right) => right.fit - left.fit || left.id - right.id);
}

export interface CivitaiCandidatePick {
  candidate: CivitaiResult;
  fit: number;
  query: string;
}

export async function pickCivitaiCandidate(
  client: CivitaiClient,
  queries: readonly string[],
  intent_tokens: readonly string[],
  orientation: "portrait" | "landscape",
  usedIds: ReadonlySet<number>,
  scorer?: CivitaiImageTextScorer
): Promise<CivitaiCandidatePick | undefined> {
  let best: CivitaiCandidatePick | undefined;
  for (const query of queries) {
    const page = await client.search({ query, orientation });
    const ranked = await rankCivitaiResults(page.results, intent_tokens, query, scorer);
    for (const hit of ranked) {
      if (usedIds.has(hit.id)) continue;
      if (!best || hit.fit > best.fit) {
        best = { candidate: hit, fit: hit.fit, query };
      }
    }
    if (best && best.fit >= 60) break;
  }
  return best;
}

