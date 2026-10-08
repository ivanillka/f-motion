import type {
  ContentTypeModule,
  CreateSessionSnapshot,
  SharedMediaCatalog,
  TypeArtifact
} from "@f-engine/content-type-contract";
import { briefPurpose } from "@f-engine/content-type-contract";
import {
  generateReelCraft,
  isReelCraftPayload,
  planReelMedia,
  qaReelCraft
} from "./craft.js";
import {
  parseReelSettings,
  REEL_VERTICAL_TYPE_ID,
  reelVerticalSettingsSchema
} from "./settings.js";

/** Vertical reel module — wraps existing reel-engine storyboard/render path. */
export const reelVerticalModule: ContentTypeModule = {
  typeId: REEL_VERTICAL_TYPE_ID,
  kind: "video",
  label: "Vertical reel",
  phase: "polish_ready",
  settingsSchema: { ...reelVerticalSettingsSchema },
  mediaPolicy: {
    requirement: "required",
    preferredSources: ["own", "pexels", "fal", "mix"]
  },
  editorModel: "storyboard",

  validateSettings(_session, settings) {
    try {
      parseReelSettings(settings);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "invalid settings" };
    }
  },

  planMedia(_session, catalog) {
    return planReelMedia(catalog);
  },

  async generate(jobCtx) {
    const settings = parseReelSettings(jobCtx.settings);
    const craftPayload = generateReelCraft({
      purpose: briefPurpose(jobCtx.session.brief),
      cta: jobCtx.session.brief.cta,
      mediaSourcePref: jobCtx.session.mediaSourcePref,
      settings,
      catalog: jobCtx.catalog,
      makeId: jobCtx.makeId
    });
    return {
      craftPayload,
      previewRef: `reel:${jobCtx.artifact.id}`
    };
  },

  preview(artifact) {
    const craft = isReelCraftPayload(artifact.craftPayload) ? artifact.craftPayload : undefined;
    return craft?.preview ?? { surface: "reel_player", aspect: "9:16" };
  },

  qa(artifact, session) {
    return qaReelCraft(artifact.craftPayload, session.mediaCatalog);
  },

  exportPackage(artifact, session) {
    // Studio Export final uses requestRender on the materialized ProjectSnapshot.
    return {
      format: "mp4",
      filename: "reel-vertical.mp4",
      ref: artifact.packageRef ?? artifact.previewRef,
      meta: {
        editorModel: "storyboard",
        typeId: REEL_VERTICAL_TYPE_ID,
        sessionId: session.id,
        artifactId: artifact.id,
        surface: "studio_render"
      }
    };
  },

  shareHandoff(artifact, session) {
    return {
      typeId: REEL_VERTICAL_TYPE_ID,
      sessionId: session.id,
      artifactId: artifact.id,
      previewRef: artifact.previewRef
    };
  }
};

export function registerReelVertical(registry: { register(module: ContentTypeModule): void }): void {
  registry.register(reelVerticalModule);
}

export type { CreateSessionSnapshot, SharedMediaCatalog, TypeArtifact };
