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

const civitaiBrowsingCap: Record<CivitaiNsfwLevel, number> = {
  None: 1,
  Soft: 2,
  Mature: 4,
  X: 8
};

export const defaultCivitaiMediaHosts = [
  "image.civitai.com",
  "blobs.civitai.com",
  "blobs-b2.civitai.com"
] as const;

export interface CivitaiPolicy {
  nsfwLevel: CivitaiNsfwLevel;
  allowedMediaHosts: ReadonlySet<string>;
}

export const defaultCivitaiPolicy: CivitaiPolicy = {
  nsfwLevel: "None",
  allowedMediaHosts: new Set(defaultCivitaiMediaHosts)
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
    allowedMediaHosts: new Set(hosts)
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

export interface CivitaiResult {
  id: number;
  creator: string;
  attributionUrl: string;
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

export interface CivitaiSearchPage {
  results: CivitaiResult[];
  nextCursor?: string;
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
  nsfw?: unknown;
  browsingLevel?: unknown;
  type?: unknown;
  username?: unknown;
  baseModel?: unknown;
  meta?: unknown;
}

interface CivitaiImagesBody {
  items?: CivitaiImageItem[];
  metadata?: { nextCursor?: unknown; nextPage?: unknown };
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

export class CivitaiClient {
  constructor(
    readonly apiKey: string,
    readonly policy: CivitaiPolicy = defaultCivitaiPolicy,
    readonly request: typeof fetch = fetch,
    readonly copyDeadlineMs = 30_000,
    readonly temporaryRoot = tmpdir()
  ) {}

  private authorization(): string {
    return `Bearer ${this.apiKey}`;
  }

  private accepts(item: CivitaiImageItem, orientation: "portrait" | "landscape"): CivitaiResult | undefined {
    if (item.type !== "image") return undefined;
    const id = Number(item.id);
    const width = Number(item.width);
    const height = Number(item.height);
    const browsingLevel = Number(item.browsingLevel);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(width) || width <= 0
      || !Number.isInteger(height) || height <= 0) return undefined;
    if (orientation === "portrait" ? height < width : width < height) return undefined;
    if (typeof item.nsfwLevel !== "string" || item.nsfwLevel !== this.policy.nsfwLevel) return undefined;
    if (!Number.isInteger(browsingLevel)
      || browsingLevel > civitaiBrowsingCap[this.policy.nsfwLevel]) return undefined;
    if (typeof item.url !== "string" || !civitaiUrlAllowed(item.url, this.policy.allowedMediaHosts)) return undefined;
    const sourceUrl = resizedImageUrl(new URL(item.url), 1280);
    const previewUrl = resizedImageUrl(new URL(item.url), 450);
    if (!civitaiUrlAllowed(sourceUrl, this.policy.allowedMediaHosts)
      || !civitaiUrlAllowed(previewUrl, this.policy.allowedMediaHosts)) return undefined;
    const creator = typeof item.username === "string" ? item.username.trim() : "";
    if (!creator || creator.length > 200) return undefined;
    let metaPrompt: string | undefined;
    if (item.meta && typeof item.meta === "object" && !Array.isArray(item.meta)) {
      const prompt = (item.meta as Record<string, unknown>).prompt;
      if (typeof prompt === "string") metaPrompt = prompt.trim();
    }
    return {
      id,
      creator,
      attributionUrl: `https://civitai.com/images/${id}`,
      previewUrl,
      sourceUrl,
      contentType: imageContentType(new URL(item.url)),
      width,
      height,
      nsfwLevel: item.nsfwLevel as CivitaiNsfwLevel,
      browsingLevel,
      ...(typeof item.baseModel === "string" && item.baseModel.trim() ? { baseModel: item.baseModel.trim() } : {}),
      ...(metaPrompt ? { prompt: metaPrompt } : {})
    };
  }

  async search(
    query: string,
    orientation: "portrait" | "landscape" = "portrait",
    cursor?: string
  ): Promise<CivitaiSearchPage> {
    const params = new URLSearchParams({
      limit: "12",
      sort: "Most Reactions",
      period: "Month",
      nsfw: this.policy.nsfwLevel
    });
    if (query) params.set("query", query);
    if (cursor) params.set("cursor", cursor);
    const response = await this.request(
      `https://civitai.com/api/v1/images?${params.toString()}`,
      { headers: { authorization: this.authorization(), accept: "application/json" } }
    );
    if (!response.ok) throw new CivitaiRequestError();
    let body: CivitaiImagesBody;
    try {
      body = await response.json() as CivitaiImagesBody;
    } catch {
      throw new CivitaiRequestError();
    }
    const nextCursor = typeof body.metadata?.nextCursor === "string" ? body.metadata.nextCursor : undefined;
    return {
      results: (body.items ?? []).flatMap((item) => {
        const result = this.accepts(item, orientation);
        return result ? [result] : [];
      }),
      ...(nextCursor ? { nextCursor } : {})
    };
  }


  async copy(
    ownerId: string,
    projectId: string,
    selected: CivitaiResult,
    repository: PostgresMediaRepository,
    store: PrivateObjectStore
  ): Promise<StoredMedia> {
    const creator = selected.creator.trim();
    if (!creator || creator.length > 200
      || !civitaiUrlAllowed(selected.attributionUrl, this.policy.allowedMediaHosts)
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
      response = await this.request(selected.sourceUrl, {
        redirect: "follow",
        signal: controller.signal,
        headers: { accept: "image/jpeg,image/png,image/webp,*/*;q=0.8" }
      });
      if (!response.ok) throw new CivitaiRequestError();
      const finalUrl = response.url || selected.sourceUrl;
      if (!civitaiUrlAllowed(finalUrl, this.policy.allowedMediaHosts)) {
        throw new Error("Civitai media origin is not allowed");
      }
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
          previewUrl: selected.previewUrl
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
  score(input: { imageUrl: string; text: string }): Promise<number>;
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
  input: { imageUrl: string; text: string },
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
      scoreWithTimeout(scorer, { imageUrl: result.previewUrl, text: query }, scorerTimeoutMs)));
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
    const page = await client.search(query, orientation);
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

