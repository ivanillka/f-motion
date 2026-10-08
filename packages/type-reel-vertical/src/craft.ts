import type { MediaRef, SharedMediaCatalog } from "@f-engine/content-type-contract";
import type { Scene, VideoArchitecture } from "@f-engine/contracts";
import {
  buildStoryboardDraft,
  conceptIdForArchitecture,
  planStoryboardScenes,
  recommendVideoArchitecture
} from "@f-engine/reel-engine";
import type { ReelVerticalSettings } from "./settings.js";

export interface ReelCraftPayload {
  kind: "reel_storyboard";
  architecture: VideoArchitecture;
  conceptId: "direct" | "story" | "rhythm";
  scenes: Scene[];
  /** Unique media attach plan — index into catalog ranks, not gallery order. */
  mediaAttach: Array<{ sceneId: string; mediaId?: string }>;
  editorModel: "storyboard";
  preview: { surface: "reel_player"; aspect: "9:16" };
  /** Intent: animate attached stills via existing FAL image-to-video (BYOK). */
  animateStills?: boolean;
}

/** Re-pick from shared catalog for this craft; stock/FAL shortlists fill gaps later. */
export function planReelMedia(catalog: SharedMediaCatalog): SharedMediaCatalog {
  const ownRanked = [...catalog.ownRanked].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return {
    ...catalog,
    ownRanked,
    ...(catalog.pexelsShortlist ? { pexelsShortlist: [...catalog.pexelsShortlist] } : {}),
    ...(catalog.falQuotes ? { falQuotes: catalog.falQuotes.map((quote) => ({ ...quote })) } : {})
  };
}

function resolveArchitecture(
  purpose: string,
  settings: ReelVerticalSettings,
  mediaPref: string
): VideoArchitecture {
  const base = recommendVideoArchitecture(purpose);
  const media: VideoArchitecture["media"] =
    mediaPref === "own" ? "own"
      : mediaPref === "mix" ? "mixed"
        : mediaPref === "pexels" || mediaPref === "fal" ? "stock"
          : base.media;
  return {
    ...base,
    delivery: "reel",
    durationSeconds: settings.durationSeconds ?? base.durationSeconds,
    media
  };
}

/** Unique attach: one ranked media id per scene, never reuse, never first-N dump. */
export function uniqueAttachPlan(scenes: Scene[], ranked: MediaRef[]): Array<{ sceneId: string; mediaId?: string }> {
  const used = new Set<string>();
  return scenes.map((scene) => {
    const pick = ranked.find((item) => item.id && !used.has(item.id));
    if (!pick?.id) return { sceneId: scene.id };
    used.add(pick.id);
    return { sceneId: scene.id, mediaId: pick.id };
  });
}

function applyAttach(scenes: Scene[], attach: Array<{ sceneId: string; mediaId?: string }>): Scene[] {
  const byScene = new Map(attach.map((item) => [item.sceneId, item.mediaId]));
  return scenes.map((scene) => {
    const mediaId = byScene.get(scene.id);
    return mediaId ? { ...scene, media_id: mediaId } : { ...scene };
  });
}

export function generateReelCraft(input: {
  purpose: string;
  cta?: string;
  mediaSourcePref: string;
  settings: ReelVerticalSettings;
  catalog: SharedMediaCatalog;
  makeId: () => string;
}): ReelCraftPayload {
  const purpose = input.purpose.trim();
  if (!purpose) throw new Error("reel requires a purpose in the brief");
  const architecture = resolveArchitecture(purpose, input.settings, input.mediaSourcePref);
  const conceptId = conceptIdForArchitecture(architecture);
  const cta = input.settings.cta?.trim() || undefined;
  const brief = {
    purpose,
    audience: architecture.audience,
    tone: architecture.tone,
    architecture,
    ...(cta ? { cta } : {}),
    ...(input.settings.brandMark ? { brand_mark: true as const } : {})
  };
  // Prefer planStoryboardScenes (Studio create path); fall back to draft builder.
  let scenes: Scene[];
  try {
    scenes = planStoryboardScenes(brief, conceptId, input.makeId, architecture, {
      ...(cta ? { callToAction: cta } : {})
    });
  } catch {
    scenes = buildStoryboardDraft(purpose, input.makeId, architecture, {
      ...(cta ? { callToAction: cta } : {})
    });
  }
  const ranked = [
    ...input.catalog.ownRanked,
    ...(input.catalog.pexelsShortlist ?? [])
  ];
  const unique = input.settings.uniqueAttach !== false;
  const mediaAttach = unique
    ? uniqueAttachPlan(scenes, ranked)
    : scenes.map((scene, index) => ({ sceneId: scene.id, mediaId: ranked[index]?.id }));
  const attached = applyAttach(scenes, mediaAttach);
  return {
    kind: "reel_storyboard",
    architecture,
    conceptId,
    scenes: attached,
    mediaAttach,
    editorModel: "storyboard",
    preview: { surface: "reel_player", aspect: "9:16" },
    ...(input.settings.animateStills === true ? { animateStills: true } : {})
  };
}

export function isReelCraftPayload(value: unknown): value is ReelCraftPayload {
  if (!value || typeof value !== "object") return false;
  const craft = value as ReelCraftPayload;
  return craft.kind === "reel_storyboard"
    && Array.isArray(craft.scenes)
    && craft.scenes.length >= 1
    && craft.editorModel === "storyboard";
}

/** Polish bar: storyboard present, intentional duration, unique media when pool exists. */
export function qaReelCraft(payload: unknown, catalog: SharedMediaCatalog): "ready" | "below_bar" {
  if (!isReelCraftPayload(payload)) return "below_bar";
  if (payload.scenes.length < 1 || payload.scenes.length > 8) return "below_bar";
  const duration = payload.scenes.reduce((sum, scene) => sum + scene.duration_ms, 0);
  if (duration < 3_000 || duration > 60_000) return "below_bar";
  const poolSize = catalog.ownRanked.length + (catalog.pexelsShortlist?.length ?? 0);
  if (poolSize > 0) {
    const attached = payload.mediaAttach.filter((item) => item.mediaId).map((item) => item.mediaId);
    if (!attached.length) return "below_bar";
    if (new Set(attached).size !== attached.length) return "below_bar";
  }
  return "ready";
}
