import type {
  AnalysisSummary,
  BriefAnswers,
  CreateSessionSnapshot,
  MediaRef,
  MediaSourcePref,
  ModuleDescriptor,
  TypeId
} from "@f-engine/content-type-contract";
import type { TypeRegistry } from "@f-engine/content-type-contract";
import { createSession, patchBrief, patchSettings, skipPool, withPoolItems, type CreateSession } from "./session.js";

/**
 * Optional pool stage seam.
 * filled → caller may enqueue AnalysisJob; skipped → no analyze, go to questions.
 */
export interface PoolSeam {
  start(ownerId: string, options?: { skipPool?: boolean }): CreateSession;
  admit(session: CreateSession, items: MediaRef[]): CreateSession;
  skip(session: CreateSession): CreateSession;
  /** No-op placeholder until Tier 0 AnalysisJob lands; returns null when skipped. */
  analyzeIfPooled(session: CreateSession, run?: (session: CreateSession) => AnalysisSummary): CreateSession;
}

export const poolSeam: PoolSeam = {
  start(ownerId, options) {
    return createSession({ ownerId, skipPool: options?.skipPool === true });
  },
  admit(session, items) {
    return withPoolItems(session, items);
  },
  skip(session) {
    return skipPool(session);
  },
  analyzeIfPooled(session, run) {
    if (session.poolMode === "skipped") return session;
    if (!run) return session;
    const analysis = run(session);
    return {
      ...session,
      analysis,
      mediaCatalog: {
        ...session.mediaCatalog,
        ownRanked: analysis.ranks.map((rank) => ({ ...rank }))
      }
    };
  }
};

export type QuestionPath = "pooled" | "skipped";

export interface QuestionSeam {
  pathFor(session: CreateSessionSnapshot): QuestionPath;
  /** Thin seam: merge answers; full adaptive ≤5 UX comes later. */
  answer(session: CreateSession, answers: BriefAnswers): CreateSession;
}

export const questionSeam: QuestionSeam = {
  pathFor(session) {
    return session.poolMode === "skipped" ? "skipped" : "pooled";
  },
  answer(session, answers) {
    return patchBrief(session, answers);
  }
};

export interface SettingsSeam {
  /** Toggle rows come only from the registry — never hardcoded type ids. */
  polishReadyTypes(registry: TypeRegistry): ModuleDescriptor[];
  apply(
    session: CreateSession,
    patch: {
      selectedTypeIds?: TypeId[];
      typeSettings?: Record<TypeId, unknown>;
      mediaSourcePref?: MediaSourcePref;
    },
    registry: TypeRegistry
  ): CreateSession;
}

export const settingsSeam: SettingsSeam = {
  polishReadyTypes(registry) {
    return registry.listPolishReady();
  },
  apply(session, patch, registry) {
    if (patch.selectedTypeIds) {
      const ready = new Set(registry.listPolishReady().map((item) => item.typeId));
      for (const typeId of patch.selectedTypeIds) {
        if (!ready.has(typeId)) {
          throw new Error(`type not polish-ready: ${typeId}`);
        }
      }
    }
    return patchSettings(session, patch);
  }
};
