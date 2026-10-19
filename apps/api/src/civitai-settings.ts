import type { Pool } from "pg";
import {
  civitaiLevelRank,
  civitaiNsfwLevels,
  type CivitaiNsfwLevel,
  type CivitaiPolicy
} from "./civitai.js";

export interface CivitaiOwnerSettings {
  maxNsfwLevel: CivitaiNsfwLevel;
  allowedCreators: string[];
  minShortSide: number;
}

export interface CivitaiSettingsView extends CivitaiOwnerSettings {
  serverMaxNsfwLevel: CivitaiNsfwLevel;
}

export interface CivitaiSettingsService {
  get(ownerId: string): Promise<CivitaiSettingsView>;
  update(ownerId: string, value: unknown): Promise<CivitaiSettingsView>;
}

export class CivitaiSettingsValidationError extends Error {}

export const defaultCivitaiOwnerSettings: CivitaiOwnerSettings = {
  maxNsfwLevel: "None",
  allowedCreators: [],
  minShortSide: 1080
};

function view(settings: CivitaiOwnerSettings, policy: CivitaiPolicy): CivitaiSettingsView {
  return {
    ...settings,
    serverMaxNsfwLevel: policy.nsfwLevel
  };
}

function parseLevel(value: unknown, policy: CivitaiPolicy): CivitaiNsfwLevel {
  if (typeof value !== "string" || !civitaiNsfwLevels.includes(value as CivitaiNsfwLevel)) {
    throw new CivitaiSettingsValidationError("invalid Civitai NSFW level");
  }
  const requested = value as CivitaiNsfwLevel;
  return civitaiLevelRank(requested) > civitaiLevelRank(policy.nsfwLevel)
    ? policy.nsfwLevel
    : requested;
}

function parseCreators(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new CivitaiSettingsValidationError("invalid Civitai creator allowlist");
  }
  const seen = new Set<string>();
  const creators: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new CivitaiSettingsValidationError("invalid Civitai creator allowlist");
    const creator = item.trim();
    if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(creator)) {
      throw new CivitaiSettingsValidationError("invalid Civitai creator allowlist");
    }
    const key = creator.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    creators.push(creator);
  }
  return creators;
}

function parseMinShortSide(value: unknown): number {
  const side = Number(value);
  if (!Number.isInteger(side) || side < 480 || side > 2160) {
    throw new CivitaiSettingsValidationError("invalid Civitai minimum resolution");
  }
  return side;
}

export class PostgresCivitaiSettingsService implements CivitaiSettingsService {
  constructor(
    readonly pool: Pool,
    readonly policy: CivitaiPolicy
  ) {}

  private async current(ownerId: string): Promise<CivitaiOwnerSettings> {
    const result = await this.pool.query<{
      maxNsfwLevel: string;
      allowedCreators: string[];
      minShortSide: number;
    }>(
      `SELECT "maxNsfwLevel", "allowedCreators", "minShortSide"
         FROM "CivitaiOwnerSettings" WHERE "ownerId" = $1`,
      [ownerId]
    );
    const row = result.rows[0];
    if (!row) return { ...defaultCivitaiOwnerSettings, allowedCreators: [] };
    return {
      maxNsfwLevel: civitaiNsfwLevels.includes(row.maxNsfwLevel as CivitaiNsfwLevel)
        ? row.maxNsfwLevel as CivitaiNsfwLevel
        : "None",
      allowedCreators: Array.isArray(row.allowedCreators) ? row.allowedCreators : [],
      minShortSide: Number.isInteger(row.minShortSide) ? row.minShortSide : 1080
    };
  }

  async get(ownerId: string): Promise<CivitaiSettingsView> {
    return view(await this.current(ownerId), this.policy);
  }

  async update(ownerId: string, value: unknown): Promise<CivitaiSettingsView> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new CivitaiSettingsValidationError("invalid Civitai settings");
    }
    const body = value as Record<string, unknown>;
    const allowedKeys = new Set(["max_nsfw_level", "allowed_creators", "min_short_side"]);
    if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
      throw new CivitaiSettingsValidationError("invalid Civitai settings");
    }
    const current = await this.current(ownerId);
    const next: CivitaiOwnerSettings = {
      maxNsfwLevel: body.max_nsfw_level === undefined
        ? current.maxNsfwLevel
        : parseLevel(body.max_nsfw_level, this.policy),
      allowedCreators: body.allowed_creators === undefined
        ? current.allowedCreators
        : parseCreators(body.allowed_creators),
      minShortSide: body.min_short_side === undefined
        ? current.minShortSide
        : parseMinShortSide(body.min_short_side)
    };
    await this.pool.query(
      `INSERT INTO "CivitaiOwnerSettings"
         ("ownerId", "maxNsfwLevel", "allowedCreators", "minShortSide", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT ("ownerId") DO UPDATE SET
         "maxNsfwLevel" = EXCLUDED."maxNsfwLevel",
         "allowedCreators" = EXCLUDED."allowedCreators",
         "minShortSide" = EXCLUDED."minShortSide",
         "updatedAt" = NOW()`,
      [ownerId, next.maxNsfwLevel, next.allowedCreators, next.minShortSide]
    );
    return view(next, this.policy);
  }
}
