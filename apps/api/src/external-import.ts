import { createHash, timingSafeEqual } from "node:crypto";
import {
  defaultVideoArchitecture,
  type StoryboardSource,
  type VideoArchitecture
} from "@f-engine/reel-engine";
import type { ProjectSnapshot } from "@f-engine/contracts";

export interface ExternalImportConfig {
  token: string;
  ownerId: string;
  webOrigin: string;
  mediaOrigins: string[];
}

export interface ExternalDraft {
  externalId: string;
  brief: ProjectSnapshot["brief"];
  architecture: VideoArchitecture;
  source: StoryboardSource;
  mediaUrls: string[];
}

const ownerIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Influencer campaign filenames use spaces, underscores, and typographic marks (× —).
const externalIdPattern = /^(?=.{1,128}$)[\p{L}\p{N}][\p{L}\p{N} ._:\-×—–,()]*$/u;

function asText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}

function clipText(value: unknown, maximum: number, fallback: string): string {
  const text = asText(value);
  if (!text) return fallback.slice(0, maximum);
  return text.slice(0, maximum);
}

export function isExternalId(value: string): boolean {
  return externalIdPattern.test(value);
}

/** Host ids may include slashes or punctuation; keep a stable allowed form. */
export function sanitizeExternalId(value: unknown): string {
  const raw = asText(value) ?? "";
  const cleaned = raw
    .replace(/[^\p{L}\p{N} ._:\-×—–,()]/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^[^ \p{L}\p{N}]+/u, "")
    .trim()
    .slice(0, 128);
  if (cleaned && isExternalId(cleaned)) return cleaned;
  const digest = createHash("sha256").update(raw || "imported").digest("hex").slice(0, 24);
  return `imported:${digest}`;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  return text.slice(0, maximum);
}

/** Fotium admin is camelCase; accept snake_case or camelCase for one field. */
function field(body: Record<string, unknown>, snake: string, camel: string): unknown {
  return body[snake] !== undefined ? body[snake] : body[camel];
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function durationSeconds(value: unknown): 15 | 30 | 45 {
  const numeric = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : Number.NaN;
  if (numeric === 15 || numeric === 30 || numeric === 45) return numeric;
  if (!Number.isFinite(numeric)) return defaultVideoArchitecture.durationSeconds;
  const options = [15, 30, 45] as const;
  return options.reduce((best, current) => Math.abs(current - numeric) < Math.abs(best - numeric) ? current : best);
}

function mediaUrlItem(item: unknown): string | undefined {
  if (typeof item === "string") return item.length <= 2_048 ? item : undefined;
  if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
  const record = item as Record<string, unknown>;
  // Influencer campaigns send { url } / { sourceUrl } per platform pick.
  const raw = record.url ?? record.source_url ?? record.sourceUrl;
  return typeof raw === "string" && raw.length <= 2_048 ? raw : undefined;
}

function mediaUrls(value: unknown): string[] {
  const items = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const urls: string[] = [];
  for (const item of items.slice(0, 8)) {
    const href = mediaUrlItem(item);
    if (!href) continue;
    try {
      const url = new URL(href);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) continue;
      urls.push(url.href);
    } catch {
      // Skip one bad host URL; the rest of the draft still opens.
    }
  }
  return [...new Set(urls)];
}

export function parseExternalDraft(value: unknown): ExternalDraft {
  const body = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const externalId = sanitizeExternalId(field(body, "external_id", "externalId"));
  const title = clipText(
    body.title,
    120,
    externalId.replace(/^(followup|queue|task|influencer|fotium|imported):/i, "").trim() || "Imported draft"
  );
  const caption = optionalText(body.caption, 500);
  const callToAction = optionalText(field(body, "call_to_action", "callToAction"), 180);
  const visualHint = optionalText(field(body, "visual_hint", "visualHint"), 240);
  const purpose = optionalText(body.purpose, 500) ?? title;
  const architectureValue = body.architecture;
  const architectureBody = architectureValue && typeof architectureValue === "object" && !Array.isArray(architectureValue)
    ? architectureValue as Record<string, unknown>
    : {};
  const parsedMediaUrls = mediaUrls(field(body, "media_urls", "mediaUrls"));
  const architecture: VideoArchitecture = {
    goal: enumValue(architectureBody.goal, ["story", "explain", "promote", "educate"], "promote"),
    audience: enumValue(architectureBody.audience, ["general", "social", "customers", "internal"], "social"),
    structure: enumValue(architectureBody.structure, ["story_arc", "mystery", "problem_solution", "chronological"], "story_arc"),
    tone: enumValue(architectureBody.tone, ["cinematic", "documentary", "energetic", "calm"], "cinematic"),
    pace: enumValue(architectureBody.pace, ["slow", "balanced", "fast"], "balanced"),
    durationSeconds: durationSeconds(
      field(architectureBody, "duration_seconds", "durationSeconds")
        ?? field(body, "duration_seconds", "durationSeconds")
        ?? defaultVideoArchitecture.durationSeconds
    ),
    // Host-supplied gallery/influencer media implies own footage unless overridden.
    media: enumValue(
      architectureBody.media,
      ["stock", "own", "mixed"],
      parsedMediaUrls.length ? "own" : "stock"
    )
  };
  const audience = optionalText(body.audience, 80) ?? "Social audience";
  return {
    externalId,
    brief: { purpose, audience, tone: `${architecture.tone}, ${architecture.pace}` },
    architecture,
    source: { ...(caption ? { caption } : {}), ...(callToAction ? { callToAction } : {}), ...(visualHint ? { visualHint } : {}) },
    mediaUrls: parsedMediaUrls
  };
}

export function externalMediaUrlAllowed(value: string, allowedOrigins: readonly string[]): boolean {
  try { return allowedOrigins.includes(new URL(value).origin); } catch { return false; }
}

export function mediaIdForExternalImport(projectId: string, sourceUrl: string): string {
  return projectIdForExternalImport(projectId, sourceUrl);
}

export function projectIdForExternalImport(ownerId: string, externalId: string): string {
  const bytes = createHash("sha256").update(ownerId).update("\0").update(externalId).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function authenticatesExternalImport(authorization: string | undefined, expectedToken: string): boolean {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) return false;
  const received = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function externalImportConfigFromEnv(
  env: Record<string, string | undefined>
): ExternalImportConfig | undefined {
  const token = env.FENGINE_IMPORT_TOKEN?.trim();
  const ownerId = env.FENGINE_IMPORT_OWNER_ID?.trim();
  const rawOrigin = env.FENGINE_WEB_ORIGIN?.trim();
  if (!token && !ownerId && !rawOrigin) return undefined;
  if (!token || token.length < 32) throw new Error("FENGINE_IMPORT_TOKEN must contain at least 32 characters");
  if (!ownerId || !ownerIdPattern.test(ownerId)) throw new Error("invalid FENGINE_IMPORT_OWNER_ID");
  if (!rawOrigin) throw new Error("missing FENGINE_WEB_ORIGIN");
  const origin = new URL(rawOrigin);
  if ((env.FENGINE_ENV === "hosted" && origin.protocol !== "https:") || origin.username || origin.password) {
    throw new Error("invalid FENGINE_WEB_ORIGIN");
  }
  const rawMediaOrigins = env.FENGINE_IMPORT_MEDIA_ORIGINS?.trim();
  const mediaOrigins = rawMediaOrigins ? rawMediaOrigins.split(",").map((value) => {
    const mediaOrigin = new URL(value.trim());
    if (mediaOrigin.protocol !== "https:" || mediaOrigin.username || mediaOrigin.password || mediaOrigin.pathname !== "/") {
      throw new Error("invalid FENGINE_IMPORT_MEDIA_ORIGINS");
    }
    return mediaOrigin.origin;
  }) : [];
  return { token, ownerId, webOrigin: origin.origin, mediaOrigins: [...new Set(mediaOrigins)] };
}

/** Hosted studio lives at /app/; marketing at / forwards leftover ?project= there. */
export function externalProjectUrl(webOrigin: string, projectId: string): string {
  const url = new URL("/app/", webOrigin);
  url.searchParams.set("project", projectId);
  return url.toString();
}
