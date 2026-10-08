/** Stable content-type id. Spine stores opaque settings keyed by this. */
export type TypeId = string;

export type ContentKind = "video" | "stills" | "text";

/** Only polish-ready modules appear in settings toggles / generate fan-out. */
export type ModulePhase = "polish_ready" | "coming";

export type MediaRequirement = "required" | "optional";

export type MediaSourcePref = "own" | "pexels" | "fal" | "mix" | "defer";

export interface MediaPolicy {
  requirement: MediaRequirement;
  preferredSources: MediaSourcePref[];
}

export type ArtifactStatus = "queued" | "running" | "ready" | "failed" | "below_bar";

export type QaVerdict = "ready" | "below_bar";

export interface MediaRef {
  id: string;
  kind?: "image" | "video";
  url?: string;
  sealedId?: string;
  score?: number;
  label?: string;
}

export interface FalQuote {
  id: string;
  status: "pending" | "confirmed" | "rejected";
  estimate?: string;
  prompt?: string;
}

export interface SharedMediaCatalog {
  ownRanked: MediaRef[];
  pexelsShortlist?: MediaRef[];
  falQuotes?: FalQuote[];
}

export interface BriefAnswers {
  purpose?: string;
  audience?: string;
  goal?: string;
  tone?: string;
  cta?: string;
  mediaSource?: MediaSourcePref;
  /** Opaque extras from path-adaptive questions. */
  extras?: Record<string, string>;
}

export interface AnalysisSummary {
  aggregates: {
    mostlyPortrait?: boolean;
    stillHeavy?: boolean;
    longSource?: boolean;
    tone?: string;
  };
  ranks: Array<MediaRef & { score: number }>;
  flags?: Record<string, boolean | string | number>;
}

export interface TypeArtifact {
  id: string;
  typeId: TypeId;
  status: ArtifactStatus;
  /** Module-private craft (storyboard | slides | doc). Spine must not interpret. */
  craftPayload?: unknown;
  previewRef?: string;
  packageRef?: string;
  error?: string;
  qa?: QaVerdict;
}

export interface CreateSessionSnapshot {
  id: string;
  ownerId: string;
  status: "drafting" | "ready" | "generating" | "partial" | "done";
  poolMode: "filled" | "skipped";
  brief: BriefAnswers;
  analysis?: AnalysisSummary;
  mediaSourcePref: MediaSourcePref;
  selectedTypeIds: TypeId[];
  typeSettings: Record<TypeId, unknown>;
  mediaCatalog: SharedMediaCatalog;
  artifacts: TypeArtifact[];
}

export interface TypeCraftJob {
  sessionId: string;
  typeId: TypeId;
  artifactId: string;
}

export interface CraftJobContext {
  session: CreateSessionSnapshot;
  artifact: TypeArtifact;
  catalog: SharedMediaCatalog;
  settings: unknown;
  /** Stable id factory for module craft objects. */
  makeId: () => string;
}

export interface ModuleDescriptor {
  typeId: TypeId;
  kind: ContentKind;
  label: string;
  phase: ModulePhase;
  mediaPolicy: MediaPolicy;
  settingsSchema: Record<string, unknown>;
  editorModel: string;
}

export interface PreviewContract {
  surface: string;
  aspect?: string;
  notes?: string;
}

export interface ExportPackage {
  format: string;
  /** Opaque handle — bytes live behind existing project/render paths when wired. */
  ref?: string;
  filename?: string;
  meta?: Record<string, unknown>;
}
