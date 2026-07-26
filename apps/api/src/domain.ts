import { randomUUID } from "node:crypto";
import type { CommandEnvelope, ProjectSnapshot } from "@f-motion/contracts";
import { applyCommand, conceptsFor } from "@f-motion/reel-engine";

export class ConflictError extends Error {
  constructor(readonly authoritativeSnapshot: ProjectSnapshot) { super("stale base revision"); }
}

export class ProjectService {
  readonly #projects = new Map<string, ProjectSnapshot>();
  readonly #receipts = new Map<string, ProjectSnapshot>();

  create(ownerId: string, brief: ProjectSnapshot["brief"]): ProjectSnapshot {
    const project: ProjectSnapshot = { schema_version: 1, id: randomUUID(), owner_id: ownerId, revision: 0, brief, scenes: [] };
    this.#projects.set(`${ownerId}:${project.id}`, project);
    return structuredClone(project);
  }

  get(ownerId: string, projectId: string): ProjectSnapshot | undefined {
    const value = this.#projects.get(`${ownerId}:${projectId}`);
    return value && structuredClone(value);
  }

  concepts(ownerId: string, projectId: string) {
    const project = this.get(ownerId, projectId);
    if (!project) throw new Error("not found");
    return conceptsFor(project.brief);
  }

  command(ownerId: string, command: CommandEnvelope): ProjectSnapshot {
    const project = this.get(ownerId, command.project_id);
    if (!project) throw new Error("not found");
    const receiptKey = `${ownerId}:${command.project_id}:${command.command_id}`;
    const prior = this.#receipts.get(receiptKey);
    if (prior) return structuredClone(prior);
    if (project.revision !== command.base_revision) throw new ConflictError(project);
    const updated = applyCommand(project, command);
    this.#projects.set(`${ownerId}:${project.id}`, updated);
    this.#receipts.set(receiptKey, updated);
    return structuredClone(updated);
  }
}

export interface UploadAdmission {
  id: string;
  ownerId: string;
  projectId: string;
  objectKey: string;
  state: "admitted" | "inspecting" | "ready" | "quarantined";
  declaredType: string;
  maxBytes: number;
}

export class MediaService {
  readonly #assets = new Map<string, UploadAdmission>();
  admit(ownerId: string, projectId: string, declaredType: string, bytes: number): UploadAdmission & { method: "PUT"; expiresInSeconds: 300 } {
    const allowed = new Set(["video/mp4", "image/jpeg", "image/png"]);
    if (!allowed.has(declaredType) || bytes <= 0 || bytes > 100_000_000) throw new Error("upload declaration rejected");
    const id = randomUUID();
    const asset: UploadAdmission = { id, ownerId, projectId, objectKey: `projects/${projectId}/media/${id}`, state: "admitted", declaredType, maxBytes: bytes };
    this.#assets.set(`${ownerId}:${projectId}:${id}`, asset);
    return { ...asset, method: "PUT", expiresInSeconds: 300 };
  }
  complete(ownerId: string, projectId: string, id: string): UploadAdmission {
    const asset = this.#assets.get(`${ownerId}:${projectId}:${id}`);
    if (!asset) throw new Error("not found");
    if (asset.state === "admitted") asset.state = "inspecting";
    return { ...asset };
  }
  inspected(ownerId: string, projectId: string, id: string, detected: { type: string; bytes: number }): UploadAdmission {
    const asset = this.#assets.get(`${ownerId}:${projectId}:${id}`);
    if (!asset) throw new Error("not found");
    asset.state = detected.type === asset.declaredType && detected.bytes <= asset.maxBytes ? "ready" : "quarantined";
    return { ...asset };
  }
}

export interface PexelsRecord { sourceUrl: string; creator: string; attributionUrl: string; sourceLabel: "Pexels"; objectKey: string }
export function copyPexelsResult(projectId: string, input: Omit<PexelsRecord, "sourceLabel" | "objectKey">): PexelsRecord {
  return { ...input, sourceLabel: "Pexels", objectKey: `projects/${projectId}/media/${randomUUID()}` };
}

export class RenderService {
  readonly #cancelled = new Set<string>();
  readonly #events = new Map<string, Array<{ eventId: string; phase: string }>>();
  create(ownerId: string, projectId: string, revision: number) {
    const jobId = randomUUID();
    this.#events.set(jobId, [{ eventId: "1", phase: "queued" }]);
    return { jobId, ownerId, projectId, revision, objectKey: `projects/${projectId}/renders/${revision}.mp4`, requestId: randomUUID() };
  }
  cancel(ownerId: string, job: { jobId: string; ownerId: string }) {
    if (job.ownerId !== ownerId) throw new Error("not found");
    this.#cancelled.add(job.jobId);
    return { jobId: job.jobId, state: "cancelled" as const };
  }
  events(ownerId: string, job: { jobId: string; ownerId: string }, lastEventId?: string) {
    if (job.ownerId !== ownerId) throw new Error("not found");
    const events = this.#events.get(job.jobId) ?? [];
    return lastEventId ? events.filter(({ eventId }) => Number(eventId) > Number(lastEventId)) : events;
  }
  signedDownload(ownerId: string, job: { ownerId: string; objectKey: string }, now = Date.now()) {
    if (job.ownerId !== ownerId) throw new Error("not found");
    return { url: `https://download.invalid/${job.objectKey}?expires=${now + 300_000}`, expiresAt: now + 300_000 };
  }
}
