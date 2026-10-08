export const REEL_VERTICAL_TYPE_ID = "reel_vertical" as const;

export interface ReelVerticalSettings {
  durationSeconds?: 15 | 30 | 45;
  brandMark?: boolean;
  cta?: string;
  /** Prefer unique attach from ranked catalog; never first-N gallery order. */
  uniqueAttach?: boolean;
  /**
   * When true, stills attached to scenes are offered for FAL image-to-video
   * (BYOK, quote→confirm). Default off. Only meaningful when the pool has stills.
   */
  animateStills?: boolean;
}

export const reelVerticalSettingsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    durationSeconds: { type: "number", enum: [15, 30, 45] },
    brandMark: { type: "boolean" },
    cta: { type: "string", maxLength: 180 },
    uniqueAttach: { type: "boolean" },
    animateStills: { type: "boolean", default: false }
  }
} as const;

export function parseReelSettings(settings: unknown): ReelVerticalSettings {
  if (settings == null) return {};
  if (typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("reel settings must be an object");
  }
  const raw = settings as Record<string, unknown>;
  const out: ReelVerticalSettings = {};
  if ("durationSeconds" in raw) {
    const value = raw.durationSeconds;
    if (value !== 15 && value !== 30 && value !== 45) {
      throw new Error("durationSeconds must be 15, 30, or 45");
    }
    out.durationSeconds = value;
  }
  if ("brandMark" in raw) {
    if (typeof raw.brandMark !== "boolean") throw new Error("brandMark must be boolean");
    out.brandMark = raw.brandMark;
  }
  if ("cta" in raw) {
    if (typeof raw.cta !== "string" || raw.cta.length > 180) throw new Error("invalid cta");
    out.cta = raw.cta.trim();
  }
  if ("uniqueAttach" in raw) {
    if (typeof raw.uniqueAttach !== "boolean") throw new Error("uniqueAttach must be boolean");
    out.uniqueAttach = raw.uniqueAttach;
  }
  if ("animateStills" in raw) {
    if (typeof raw.animateStills !== "boolean") throw new Error("animateStills must be boolean");
    out.animateStills = raw.animateStills;
  }
  for (const key of Object.keys(raw)) {
    if (!["durationSeconds", "brandMark", "cta", "uniqueAttach", "animateStills"].includes(key)) {
      throw new Error(`unknown reel setting: ${key}`);
    }
  }
  return out;
}
