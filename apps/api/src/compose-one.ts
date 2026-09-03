import { randomUUID } from "node:crypto";
import type { CommandEnvelope, ProjectSnapshot } from "@f-engine/contracts";
import { conceptIdForArchitecture, recommendVideoArchitecture } from "@f-engine/reel-engine";
import { QuotaExceededError } from "./host-usage.js";
import type { ProjectRepository } from "./domain.js";
import { ProjectBusyError, type ProjectPurgeResult } from "./project-purge.js";
import type { RenderKind } from "./render-repository.js";

export class ComposeIncompleteError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export type ComposeOneInput = {
  purpose: string;
  audience?: string;
  tone?: string;
  fillStock?: boolean;
  render?: "preview" | "final" | "none";
};

export type ComposeOneResult = {
  project_id: string;
  revision: number;
  ready_scenes: number;
  scene_count: number;
  next: "preview_ready" | "draft_only" | "needs_media";
  render?: {
    job_id: string;
    phase: string;
    kind: string;
    download?: { url: string; expires_at: string; kind: string };
  };
};

export type BatchItemInput = ComposeOneInput & { keep?: boolean };

export type BatchItemResult = {
  index: number;
  purpose: string;
  ok: boolean;
  project_id?: string;
  job_id?: string;
  download?: { url: string; expires_at: string; kind: string };
  purged?: boolean;
  error?: string;
  quota_exceeded?: boolean;
};

export type BatchRunResult = {
  ok: boolean;
  render: "preview" | "final";
  items: BatchItemResult[];
  succeeded: number;
  failed: number;
};

export type ComposeOneDeps = {
  projects: ProjectRepository;
  fillStock?: (ownerId: string, projectId: string) => Promise<void>;
  requestRender?: (
    ownerId: string,
    projectId: string,
    kind: RenderKind
  ) => Promise<{ job_id: string; kind: string }>;
  waitRender?: (ownerId: string, jobId: string) => Promise<{ phase: string }>;
  download?: (ownerId: string, jobId: string) => Promise<{ url: string; expires_at: string; kind: string }>;
  purge?: (ownerId: string, projectId: string) => Promise<ProjectPurgeResult | { deleted: boolean; storage_failures: string[] } | undefined>;
};

function envelope(
  projectId: string,
  revision: number,
  kind: CommandEnvelope["kind"],
  payload: Record<string, unknown>
): CommandEnvelope {
  return {
    command_id: randomUUID(),
    project_id: projectId,
    base_revision: revision,
    client_timestamp: new Date().toISOString(),
    kind,
    payload
  };
}

function readiness(project: ProjectSnapshot): Pick<ComposeOneResult, "ready_scenes" | "scene_count" | "next"> {
  const ready_scenes = project.scenes.filter((scene) => scene.media_id).length;
  return {
    ready_scenes,
    scene_count: project.scenes.length,
    next: ready_scenes === 0
      ? "draft_only"
      : ready_scenes < project.scenes.length
        ? "needs_media"
        : "preview_ready"
  };
}

export async function composeOne(
  deps: ComposeOneDeps,
  ownerId: string,
  input: ComposeOneInput
): Promise<ComposeOneResult> {
  const purpose = input.purpose.trim();
  if (!purpose || purpose.length > 500) throw new Error("invalid brief");
  const brief = {
    purpose,
    audience: input.audience?.trim() || "Customers",
    tone: input.tone?.trim() || "Warm"
  };
  let project = await deps.projects.create(ownerId, brief);
  try {
    if (!project.scenes.length) {
      const architecture = recommendVideoArchitecture(purpose);
      project = await deps.projects.command(ownerId, envelope(project.id, project.revision, "select_concept", {
        concept_id: conceptIdForArchitecture(architecture),
        architecture
      }));
    }
    if (input.fillStock && deps.fillStock) {
      await deps.fillStock(ownerId, project.id);
      const latest = await deps.projects.get(ownerId, project.id);
      if (!latest) throw new Error("not found");
      project = latest;
    }
    const ready = readiness(project);
    const result: ComposeOneResult = {
      project_id: project.id,
      revision: project.revision,
      ...ready
    };
    if (input.render !== "none" && ready.next === "preview_ready") {
      if (!deps.requestRender || !deps.waitRender) {
        throw new Error("render is not configured");
      }
      const kind = input.render === "final" ? "final" : "preview";
      const job = await deps.requestRender(ownerId, project.id, kind);
      const waited = await deps.waitRender(ownerId, job.job_id);
      const download = waited.phase === "complete" && deps.download
        ? await deps.download(ownerId, job.job_id)
        : undefined;
      result.render = {
        job_id: job.job_id,
        phase: waited.phase,
        kind: job.kind,
        ...(download ? { download } : {})
      };
    }
    return result;
  } catch (error) {
    if (error && typeof error === "object") Object.assign(error, { project_id: project.id });
    throw error;
  }
}

export async function runBatch(
  deps: ComposeOneDeps,
  ownerId: string,
  items: BatchItemInput[],
  options: { render?: "preview" | "final"; keepOnFailure?: boolean; failFast?: boolean } = {}
): Promise<BatchRunResult> {
  if (!items.length) throw new Error("Batch has no items");
  const render = options.render === "preview" ? "preview" : "final";
  const results: BatchItemResult[] = [];

  for (const [index, item] of items.entries()) {
    let projectId: string | undefined;
    try {
      const composed = await composeOne(deps, ownerId, { ...item, render });
      projectId = composed.project_id;
      if (!composed.render || composed.render.phase !== "complete" || !composed.render.download) {
        throw new ComposeIncompleteError(
          composed.next === "preview_ready"
            ? "render did not complete"
            : composed.next === "needs_media"
              ? "storyboard still needs media"
              : "no ready media to render"
        );
      }
      let purged = false;
      if (deps.purge) {
        await deps.purge(ownerId, projectId);
        purged = true;
      }
      results.push({
        index,
        purpose: item.purpose,
        ok: true,
        project_id: projectId,
        job_id: composed.render.job_id,
        download: composed.render.download,
        purged
      });
    } catch (error) {
      const id = projectId
        || (error && typeof error === "object" && "project_id" in error
          ? String((error as { project_id?: unknown }).project_id || "")
          : "");
      let purged = false;
      if (id && deps.purge && !options.keepOnFailure) {
        try {
          await deps.purge(ownerId, id);
          purged = true;
        } catch {
          purged = false;
        }
      }
      const quota = error instanceof QuotaExceededError
        || (typeof error === "object" && error !== null
          && (error as { type?: string }).type === "quota_exceeded");
      results.push({
        index,
        purpose: item.purpose,
        ok: false,
        project_id: id || undefined,
        purged,
        quota_exceeded: quota || undefined,
        error: error instanceof Error ? error.message : String(error)
      });
      if (options.failFast || quota) break;
    }
  }

  return {
    ok: results.every((item) => item.ok),
    render,
    items: results,
    succeeded: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length
  };
}

export { ProjectBusyError };
