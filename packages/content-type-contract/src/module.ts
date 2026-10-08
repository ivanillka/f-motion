import type {
  BriefAnswers,
  CreateSessionSnapshot,
  CraftJobContext,
  ExportPackage,
  MediaPolicy,
  ModuleDescriptor,
  ModulePhase,
  PreviewContract,
  QaVerdict,
  SharedMediaCatalog,
  TypeArtifact,
  TypeId,
  ContentKind
} from "./types.js";

/**
 * One polish-ready content type. Spine only sees TypeId + registry metadata;
 * craft lives entirely behind this boundary.
 */
export interface ContentTypeModule {
  readonly typeId: TypeId;
  readonly kind: ContentKind;
  readonly label: string;
  readonly phase: ModulePhase;
  readonly settingsSchema: Record<string, unknown>;
  readonly mediaPolicy: MediaPolicy;
  readonly editorModel: string;

  validateSettings(session: CreateSessionSnapshot, settings: unknown): { ok: true } | { ok: false; error: string };
  planMedia(session: CreateSessionSnapshot, catalog: SharedMediaCatalog): SharedMediaCatalog | Promise<SharedMediaCatalog>;
  generate(jobCtx: CraftJobContext): Promise<{ craftPayload: unknown; previewRef?: string }>;
  preview(artifact: TypeArtifact): PreviewContract;
  qa(artifact: TypeArtifact, session: CreateSessionSnapshot): QaVerdict | Promise<QaVerdict>;
  exportPackage(artifact: TypeArtifact, session: CreateSessionSnapshot): ExportPackage | Promise<ExportPackage>;
  shareHandoff?(artifact: TypeArtifact, session: CreateSessionSnapshot): Record<string, unknown> | undefined;
}

export function describeModule(module: ContentTypeModule): ModuleDescriptor {
  return {
    typeId: module.typeId,
    kind: module.kind,
    label: module.label,
    phase: module.phase,
    mediaPolicy: module.mediaPolicy,
    settingsSchema: module.settingsSchema,
    editorModel: module.editorModel
  };
}

/** Brief helpers modules may use; spine does not interpret delivery as a type. */
export function briefPurpose(brief: BriefAnswers): string {
  return (brief.purpose ?? "").trim();
}
