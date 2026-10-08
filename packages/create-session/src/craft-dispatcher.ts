import { randomUUID } from "node:crypto";
import type {
  ContentTypeModule,
  CreateSessionSnapshot,
  TypeArtifact,
  TypeCraftJob,
  TypeId
} from "@f-engine/content-type-contract";
import { TypeRegistry, TypeRegistryError } from "@f-engine/content-type-contract";
import { Gate0Policy } from "./gate0.js";
import { replaceArtifact, type CreateSession } from "./session.js";

export interface DispatchResult {
  session: CreateSession;
  jobs: TypeCraftJob[];
}

/**
 * Fan-out only via TypeRegistry.selected — never switch(type).
 * Each TypeCraftJob fails independently.
 */
export class CraftDispatcher {
  constructor(
    readonly registry: TypeRegistry,
    readonly gate0: Gate0Policy = new Gate0Policy()
  ) {}

  /** Validate selection + settings, enqueue sibling artifacts as queued jobs. */
  enqueue(session: CreateSessionSnapshot): DispatchResult {
    this.gate0.assertMediaSourcePref(session.mediaSourcePref);
    const modules = this.registry.selected(session.selectedTypeIds);
    if (!modules.length) throw new TypeRegistryError("no polish-ready types selected");

    let next: CreateSession = {
      ...session,
      status: "generating",
      artifacts: session.artifacts.filter((artifact) => !session.selectedTypeIds.includes(artifact.typeId))
    };
    const jobs: TypeCraftJob[] = [];

    for (const module of modules) {
      const settings = session.typeSettings[module.typeId] ?? {};
      const valid = module.validateSettings(session, settings);
      if (!valid.ok) throw new TypeRegistryError(`${module.typeId}: ${valid.error}`);
      if (module.mediaPolicy.requirement === "required") {
        assertMediaResolved(session, module);
      }
      const artifact: TypeArtifact = {
        id: randomUUID(),
        typeId: module.typeId,
        status: "queued"
      };
      next = replaceArtifact(next, artifact);
      jobs.push({ sessionId: session.id, typeId: module.typeId, artifactId: artifact.id });
    }
    return { session: next, jobs };
  }

  /** Run one job: planMedia → generate → qa. Sibling failures do not throw past this job. */
  async runJob(session: CreateSession, job: TypeCraftJob): Promise<CreateSession> {
    const artifact = session.artifacts.find((item) => item.id === job.artifactId);
    if (!artifact) throw new TypeRegistryError(`unknown artifact: ${job.artifactId}`);
    if (artifact.typeId !== job.typeId) {
      throw new TypeRegistryError(`artifact type mismatch: ${artifact.typeId} !== ${job.typeId}`);
    }

    let module: ContentTypeModule;
    try {
      module = this.registry.require(job.typeId);
    } catch (error) {
      return replaceArtifact(session, {
        ...artifact,
        status: "failed",
        error: error instanceof Error ? error.message : "unknown type"
      });
    }

    if (module.phase !== "polish_ready") {
      return replaceArtifact(session, {
        ...artifact,
        status: "failed",
        error: "type is not polish-ready"
      });
    }

    let running: TypeArtifact = { ...artifact, status: "running", error: undefined };
    let next = replaceArtifact(session, running);

    try {
      const settings = next.typeSettings[module.typeId] ?? {};
      const catalog = await module.planMedia(next, next.mediaCatalog);
      next = { ...next, mediaCatalog: catalog };
      const generated = await module.generate({
        session: next,
        artifact: running,
        catalog,
        settings,
        makeId: () => randomUUID()
      });
      running = {
        ...running,
        status: "ready",
        craftPayload: generated.craftPayload,
        previewRef: generated.previewRef
      };
      const verdict = await module.qa(running, next);
      running = {
        ...running,
        qa: verdict,
        status: verdict === "below_bar" ? "below_bar" : "ready"
      };
      next = replaceArtifact(next, running);
    } catch (error) {
      next = replaceArtifact(next, {
        ...running,
        status: "failed",
        error: error instanceof Error ? error.message : "craft failed"
      });
    }

    return withAggregateStatus(next);
  }

  async runAll(session: CreateSessionSnapshot): Promise<CreateSession> {
    const { session: queued, jobs } = this.enqueue(session);
    let next = queued;
    for (const job of jobs) {
      next = await this.runJob(next, job);
    }
    return next;
  }
}

function assertMediaResolved(session: CreateSessionSnapshot, module: ContentTypeModule): void {
  const catalog = session.mediaCatalog;
  const hasOwn = catalog.ownRanked.length > 0;
  const hasStock = (catalog.pexelsShortlist?.length ?? 0) > 0;
  const hasFal = (catalog.falQuotes ?? []).some((quote) => quote.status === "confirmed");
  const pref = session.mediaSourcePref;
  if (pref === "defer" && !hasOwn && !hasStock && !hasFal) {
    throw new TypeRegistryError(`${module.typeId}: media required before generate`);
  }
  if (pref === "own" && !hasOwn) {
    throw new TypeRegistryError(`${module.typeId}: own media required`);
  }
  if (pref === "pexels" && !hasStock && !hasOwn) {
    throw new TypeRegistryError(`${module.typeId}: Pexels shortlist or own media required`);
  }
  if (pref === "fal" && !hasFal && !hasOwn) {
    throw new TypeRegistryError(`${module.typeId}: confirmed FAL quote or own media required`);
  }
}

function withAggregateStatus(session: CreateSession): CreateSession {
  const artifacts = session.artifacts;
  if (!artifacts.length) return { ...session, status: "ready" };
  const terminal = artifacts.every((item) =>
    item.status === "ready" || item.status === "failed" || item.status === "below_bar"
  );
  if (!terminal) return { ...session, status: "generating" };
  const anyReady = artifacts.some((item) => item.status === "ready" || item.status === "below_bar");
  const anyFailed = artifacts.some((item) => item.status === "failed");
  if (anyReady && anyFailed) return { ...session, status: "partial" };
  if (anyReady) return { ...session, status: "done" };
  return { ...session, status: "partial" };
}

/** Convenience: selected type ids only — used by API list/generate. */
export function polishReadyTypeIds(registry: TypeRegistry): TypeId[] {
  return registry.listPolishReady().map((item) => item.typeId);
}
