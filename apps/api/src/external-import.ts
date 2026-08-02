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
const externalIdPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function requiredText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`invalid ${name}`);
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`invalid ${name}`);
  return result;
}

function optionalText(value: unknown, name: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, name, maximum);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T, name: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`invalid ${name}`);
  return value as T;
}

function mediaUrls(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("invalid media_urls");
  const urls = value.map((item) => {
    if (typeof item !== "string" || item.length > 2_048) throw new Error("invalid media_urls");
    let url: URL;
    try { url = new URL(item); } catch { throw new Error("invalid media_urls"); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("invalid media_urls");
    return url.href;
  });
  return [...new Set(urls)];
}

export function parseExternalDraft(value: unknown): ExternalDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid external draft");
  const body = value as Record<string, unknown>;
  const externalId = requiredText(body.external_id, "external_id", 128);
  if (!externalIdPattern.test(externalId)) throw new Error("invalid external_id");
  const title = requiredText(body.title, "title", 120);
  const goal = optionalText(body.goal, "goal", 80);
  const caption = optionalText(body.caption, "caption", 500);
  const callToAction = optionalText(body.call_to_action, "call_to_action", 180);
  const visualHint = optionalText(body.visual_hint, "visual_hint", 240);
  const purpose = optionalText(body.purpose, "purpose", 500)
    ?? [title, goal, caption, callToAction].filter(Boolean).join(". ").slice(0, 500);
  const architectureValue = body.architecture === undefined ? {} : body.architecture;
  if (!architectureValue || typeof architectureValue !== "object" || Array.isArray(architectureValue)) {
    throw new Error("invalid architecture");
  }
  const architectureBody = architectureValue as Record<string, unknown>;
  const duration = architectureBody.duration_seconds ?? defaultVideoArchitecture.durationSeconds;
  if (duration !== 15 && duration !== 30 && duration !== 45) throw new Error("invalid duration_seconds");
  const architecture: VideoArchitecture = {
    goal: enumValue(architectureBody.goal, ["story", "explain", "promote", "educate"], "promote", "goal"),
    audience: enumValue(architectureBody.audience, ["general", "social", "customers", "internal"], "social", "audience"),
    structure: enumValue(architectureBody.structure, ["story_arc", "mystery", "problem_solution", "chronological"], "story_arc", "structure"),
    tone: enumValue(architectureBody.tone, ["cinematic", "documentary", "energetic", "calm"], "cinematic", "tone"),
    pace: enumValue(architectureBody.pace, ["slow", "balanced", "fast"], "balanced", "pace"),
    durationSeconds: duration,
    media: enumValue(architectureBody.media, ["stock", "own", "mixed"], "stock", "media")
  };
  const audience = optionalText(body.audience, "audience", 80) ?? "Social audience";
  return {
    externalId,
    brief: { purpose, audience, tone: `${architecture.tone}, ${architecture.pace}` },
    architecture,
    source: { ...(caption ? { caption } : {}), ...(callToAction ? { callToAction } : {}), ...(visualHint ? { visualHint } : {}) },
    mediaUrls: mediaUrls(body.media_urls)
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

export function externalProjectUrl(webOrigin: string, projectId: string): string {
  const url = new URL("/", webOrigin);
  url.searchParams.set("project", projectId);
  return url.toString();
}
