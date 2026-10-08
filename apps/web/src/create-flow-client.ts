/** Create-session client for the reel module — no Vite-only imports. */

export type MediaSourcePref = "own" | "pexels" | "fal" | "mix" | "defer";

export interface ReelScene {
  id: string;
  order: number;
  caption: string;
  duration_ms: number;
  focal_x: number;
  focal_y: number;
  motion: "none" | "push" | "zoom";
  audio_level: number;
  ducking: boolean;
  media_id?: string;
  visual_prompt?: string;
  [key: string]: unknown;
}

export interface ReelArchitecture {
  goal: string;
  audience: string;
  structure: string;
  tone: string;
  pace: string;
  durationSeconds: 15 | 30 | 45;
  media: "stock" | "own" | "mixed";
  delivery?: "reel" | "story" | "youtube";
}

export interface ReelCraftPayload {
  kind: "reel_storyboard";
  architecture: ReelArchitecture;
  conceptId: "direct" | "story" | "rhythm";
  scenes: ReelScene[];
  mediaAttach: Array<{ sceneId: string; mediaId?: string }>;
  editorModel: "storyboard";
  preview: { surface: string; aspect?: string };
}

export interface CreateSessionView {
  id: string;
  ownerId: string;
  status: string;
  poolMode: "filled" | "skipped";
  brief: Record<string, unknown>;
  mediaSourcePref: MediaSourcePref;
  selectedTypeIds: string[];
  artifacts: Array<{
    id: string;
    typeId: string;
    status: string;
    craftPayload?: unknown;
    error?: string;
  }>;
}

export interface CreateFlowRequest {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

function freshId(): string {
  if (typeof crypto?.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // insecure context
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Honest pref: never claim Pexels/FAL without a connected key. */
export function mediaPrefFromPlan(
  plan: { media: "stock" | "own" | "mixed" },
  opts: { hasOwn: boolean; pexelsConnected: boolean; falConnected?: boolean }
): MediaSourcePref {
  if (plan.media === "own") return opts.hasOwn ? "own" : "defer";
  if (plan.media === "mixed") {
    if (opts.hasOwn && opts.pexelsConnected) return "mix";
    if (opts.hasOwn) return "own";
    if (opts.pexelsConnected) return "pexels";
    return "defer";
  }
  if (opts.pexelsConnected) return "pexels";
  if (opts.hasOwn) return "own";
  return "defer";
}

export function isReelCraftPayload(value: unknown): value is ReelCraftPayload {
  if (!value || typeof value !== "object") return false;
  const craft = value as ReelCraftPayload;
  return craft.kind === "reel_storyboard"
    && Array.isArray(craft.scenes)
    && craft.scenes.length >= 1
    && craft.editorModel === "storyboard"
    && typeof craft.conceptId === "string";
}

/** Strip catalog media ids — pool refs are not project assets yet. */
export function scenesFromReelCraft(craft: ReelCraftPayload): ReelScene[] {
  return craft.scenes.map((scene, order) => {
    const { media_id: _mediaId, ...withoutMedia } = scene;
    return {
      ...withoutMedia,
      id: freshId(),
      order,
      visual_prompt: scene.visual_prompt
        || `${craft.architecture.goal} scene ${order + 1}`.slice(0, 240)
    };
  });
}

export function projectBriefFromReelCraft(
  craft: ReelCraftPayload,
  base: {
    purpose: string;
    audience: string;
    tone: string;
    architecture?: ReelArchitecture;
    media_glance?: unknown;
    frame?: "reel" | "desktop" | "both";
    mix?: true;
    cta?: string;
    brand_mark?: boolean;
  }
) {
  return {
    ...base,
    architecture: craft.architecture,
    audience: base.audience || craft.architecture.audience,
    tone: base.tone || `${craft.architecture.tone}, ${craft.architecture.pace}`
  };
}

/**
 * Spine path: CreateSession → generate reel_vertical → craft payload.
 * Caller opens a real ProjectSnapshot and lands in the existing editor.
 */
export async function generateReelSession(
  api: CreateFlowRequest,
  input: {
    purpose: string;
    skipPool: boolean;
    poolItems?: Array<{ id: string; kind?: "image" | "video"; score?: number; label?: string }>;
    mediaSourcePref: MediaSourcePref;
    durationSeconds?: 15 | 30 | 45;
    cta?: string;
  }
): Promise<{ session: CreateSessionView; craft: ReelCraftPayload }> {
  const created = await api.request<{ session: CreateSessionView }>("/api/create-sessions", {
    method: "POST",
    body: JSON.stringify({
      skipPool: input.skipPool,
      brief: { purpose: input.purpose, ...(input.cta ? { cta: input.cta } : {}) }
    })
  });
  let session = created.session;

  if (!input.skipPool && input.poolItems?.length) {
    const pooled = await api.request<{ session: CreateSessionView }>(
      `/api/create-sessions/${session.id}/pool/items`,
      {
        method: "POST",
        body: JSON.stringify({ items: input.poolItems })
      }
    );
    session = pooled.session;
  } else if (input.skipPool && session.poolMode !== "skipped") {
    const skipped = await api.request<{ session: CreateSessionView }>(
      `/api/create-sessions/${session.id}/pool/skip`,
      { method: "POST", body: "{}" }
    );
    session = skipped.session;
  }

  const settings = await api.request<{ session: CreateSessionView }>(
    `/api/create-sessions/${session.id}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify({
        selectedTypeIds: ["reel_vertical"],
        mediaSourcePref: input.mediaSourcePref,
        typeSettings: {
          reel_vertical: {
            durationSeconds: input.durationSeconds,
            uniqueAttach: true,
            ...(input.cta ? { cta: input.cta } : {})
          }
        }
      })
    }
  );
  session = settings.session;

  const generated = await api.request<{ session: CreateSessionView }>(
    `/api/create-sessions/${session.id}/generate`,
    { method: "POST", body: "{}" }
  );
  session = generated.session;
  const artifact = session.artifacts.find((item) => item.typeId === "reel_vertical");
  if (!artifact || artifact.status === "failed") {
    throw new Error(artifact?.error || "Reel craft failed");
  }
  if (!isReelCraftPayload(artifact.craftPayload)) {
    throw new Error("Reel craft payload was invalid");
  }
  return { session, craft: artifact.craftPayload };
}
