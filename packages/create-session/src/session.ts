import { randomUUID } from "node:crypto";
import type {
  AnalysisSummary,
  BriefAnswers,
  CreateSessionSnapshot,
  MediaRef,
  MediaSourcePref,
  SharedMediaCatalog,
  TypeArtifact,
  TypeId
} from "@f-engine/content-type-contract";

export type CreateSession = CreateSessionSnapshot;

export interface CreateSessionInit {
  ownerId: string;
  skipPool?: boolean;
  brief?: BriefAnswers;
  mediaSourcePref?: MediaSourcePref;
  selectedTypeIds?: TypeId[];
}

export function emptyCatalog(): SharedMediaCatalog {
  return { ownRanked: [] };
}

export function createSession(init: CreateSessionInit): CreateSession {
  const poolMode = init.skipPool ? "skipped" : "filled";
  return {
    id: randomUUID(),
    ownerId: init.ownerId,
    status: "drafting",
    poolMode,
    brief: { ...(init.brief ?? {}) },
    mediaSourcePref: init.mediaSourcePref ?? init.brief?.mediaSource ?? "defer",
    selectedTypeIds: [...(init.selectedTypeIds ?? [])],
    typeSettings: {},
    mediaCatalog: emptyCatalog(),
    artifacts: []
  };
}

export function withPoolItems(session: CreateSession, items: MediaRef[]): CreateSession {
  const catalog: SharedMediaCatalog = {
    ...session.mediaCatalog,
    ownRanked: [...items]
  };
  return {
    ...session,
    poolMode: items.length ? "filled" : session.poolMode,
    mediaCatalog: catalog,
    status: session.status === "drafting" ? "drafting" : session.status
  };
}

export function skipPool(session: CreateSession): CreateSession {
  return {
    ...session,
    poolMode: "skipped",
    analysis: undefined,
    mediaCatalog: { ...session.mediaCatalog, ownRanked: [] }
  };
}

export function patchBrief(session: CreateSession, brief: BriefAnswers): CreateSession {
  const nextBrief = { ...session.brief, ...brief };
  const mediaSourcePref = brief.mediaSource ?? session.mediaSourcePref;
  return { ...session, brief: nextBrief, mediaSourcePref };
}

export function patchSettings(
  session: CreateSession,
  patch: {
    selectedTypeIds?: TypeId[];
    typeSettings?: Record<TypeId, unknown>;
    mediaSourcePref?: MediaSourcePref;
  }
): CreateSession {
  return {
    ...session,
    ...(patch.selectedTypeIds ? { selectedTypeIds: [...patch.selectedTypeIds] } : {}),
    ...(patch.typeSettings
      ? { typeSettings: { ...session.typeSettings, ...patch.typeSettings } }
      : {}),
    ...(patch.mediaSourcePref ? { mediaSourcePref: patch.mediaSourcePref } : {}),
    status: session.status === "drafting" ? "ready" : session.status
  };
}

export function setAnalysis(session: CreateSession, analysis: AnalysisSummary): CreateSession {
  if (session.poolMode === "skipped") {
    throw new Error("analysis is not allowed when pool is skipped");
  }
  return {
    ...session,
    analysis,
    mediaCatalog: {
      ...session.mediaCatalog,
      ownRanked: analysis.ranks.map((rank) => ({ ...rank }))
    }
  };
}

export function replaceArtifact(session: CreateSession, artifact: TypeArtifact): CreateSession {
  const others = session.artifacts.filter((item) => item.id !== artifact.id);
  return { ...session, artifacts: [...others, artifact] };
}
