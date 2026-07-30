import express from "express";
import { randomUUID } from "node:crypto";
import { conceptsFor } from "@f-engine/reel-engine";
import type { CommandEnvelope } from "@f-engine/contracts";
import {
  AccountUnavailableError,
  UnauthorizedError,
  assertAccountActive,
  authenticateBearer,
  type AccountStateLookup,
  type AuthConfig,
  type EnsureUser
} from "./auth.js";
import {
  ConflictError,
  NotFoundError,
  ProjectService,
  ValidationError,
  type ProjectRepository
} from "./domain.js";
import {
  allowedMediaTypes,
  maximumMediaBytes,
  type PexelsClient,
  type PostgresMediaRepository,
  type PrivateObjectStore
} from "./media-storage.js";
import { PostgresRenderRepository, RenderCapacityError } from "./render-repository.js";
import type { AccessPolicy } from "./access-policy.js";

export interface MediaDependencies {
  repository: PostgresMediaRepository;
  store: PrivateObjectStore;
  pexels: PexelsClient;
}

interface AppBaseOptions {
  projects: ProjectRepository;
  media?: MediaDependencies;
  renders?: PostgresRenderRepository;
  ready?: () => boolean | Promise<boolean>;
  workerOrigin?: string;
}

export interface AppOptions extends AppBaseOptions {
  authConfig: AuthConfig;
  accountState: AccountStateLookup;
  ensureUser?: EnsureUser;
  accessPolicy?: AccessPolicy;
}

export interface TestAppOptions extends Omit<AppBaseOptions, "projects"> {
  ownerId?: string;
  accountState?: string;
  projects?: ProjectRepository;
}

type Identify = (authorization: string | undefined) => Promise<string>;

async function assertReadySceneMedia(
  ownerId: string,
  command: CommandEnvelope,
  media: MediaDependencies | undefined
): Promise<void> {
  if (command.kind !== "update_scene") return;
  const scene = command.payload.scene;
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) return;
  const mediaId = (scene as { media_id?: unknown }).media_id;
  if (mediaId === undefined || mediaId === null) return;
  if (typeof mediaId !== "string" || !mediaId) throw new ValidationError("media_id invalid");
  if (!media?.repository) throw new ValidationError("media_id not ready");
  const asset = await media.repository.get(ownerId, command.project_id, mediaId);
  if (!asset || asset.state !== "ready") throw new ValidationError("media_id not ready");
}

function commandEnvelope(value: unknown, projectId: string): CommandEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("invalid command");
  const command = value as Record<string, unknown>;
  if (typeof command.command_id !== "string"
    || !command.command_id
    || !Number.isInteger(command.base_revision)
    || typeof command.client_timestamp !== "string"
    || !["select_concept", "update_scene", "reorder_scene"].includes(String(command.kind))
    || !command.payload
    || typeof command.payload !== "object"
    || Array.isArray(command.payload)) {
    throw new ValidationError("invalid command");
  }
  const base_revision = command.base_revision as number;
  if (base_revision < 0) throw new ValidationError("invalid command");
  return {
    command_id: command.command_id,
    project_id: projectId,
    base_revision,
    client_timestamp: command.client_timestamp,
    kind: command.kind as CommandEnvelope["kind"],
    payload: command.payload as Record<string, unknown>
  };
}

function projectBrief(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("invalid brief");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.purpose !== "string") throw new ValidationError("invalid brief");
  const purpose = body.purpose.trim();
  if (!purpose || purpose.length > 500) throw new ValidationError("invalid brief");
  const field = (name: "audience" | "tone", fallback: string) => {
    const raw = body[name];
    if (raw === undefined) return fallback;
    if (typeof raw !== "string") throw new ValidationError("invalid brief");
    const result = raw.trim();
    if (!result || result.length > 80) throw new ValidationError("invalid brief");
    return result;
  };
  return {
    purpose,
    audience: field("audience", "Customers"),
    tone: field("tone", "Warm")
  };
}

function pexelsQuery(value: unknown): string {
  if (typeof value !== "string") throw new ValidationError("invalid Pexels query");
  const query = value.trim();
  if (!query || query.length > 100) throw new ValidationError("invalid Pexels query");
  return query;
}

function buildApp(options: AppBaseOptions, identify: Identify) {
  const app = express();
  const projects = options.projects;
  const ready = options.ready ?? (() => true);
  app.use(express.json());
  app.use((request, response, next) => {
    const requestId = request.header("x-request-id") || randomUUID();
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", async (_request, response) => {
    const isReady = await Promise.resolve(ready()).catch(() => false);
    if (isReady) return response.json({ status: "ready" });
    response.status(503).json({ status: "unavailable" });
  });
  app.use("/api", async (request, response, next) => {
    try {
      response.locals.ownerId = await identify(request.header("authorization"));
      next();
    } catch (error) {
      if (error instanceof UnauthorizedError) return response.status(401).json({ type: "unauthorized", message: error.message });
      if (error instanceof AccountUnavailableError) return response.status(403).json({ type: "forbidden", message: error.message });
      next(error);
    }
  });
  app.get("/api/projects", async (_request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      response.json({ projects: await projects.list(ownerId) });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/projects/:projectId", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      const project = await projects.get(ownerId, request.params.projectId);
      if (!project) return response.status(404).json({ type: "not_found", message: "not found" });
      const body: { project: typeof project; concepts?: ReturnType<typeof conceptsFor> } = { project };
      if (project.scenes.length === 0) body.concepts = conceptsFor(project.brief);
      response.json(body);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      const brief = projectBrief(request.body);
      const project = await projects.create(ownerId, brief);
      response.status(201).json({ project, concepts: conceptsFor(project.brief) });
    } catch (error) {
      if (error instanceof ValidationError) {
        return response.status(422).json({ type: "validation", message: error.message });
      }
      next(error);
    }
  });
  app.post("/api/projects/:projectId/commands", async (request, response, next) => {
    const ownerId = String(response.locals.ownerId);
    try {
      const command = commandEnvelope(request.body, request.params.projectId);
      await assertReadySceneMedia(ownerId, command, options.media);
      response.json(await projects.command(ownerId, command));
    } catch (error) {
      if (error instanceof ConflictError) {
        return response.status(409).json({
          type: "conflict",
          message: error.message,
          authoritative_snapshot: error.authoritativeSnapshot
        });
      }
      if (error instanceof NotFoundError) return response.status(404).json({ type: "not_found", message: error.message });
      if (error instanceof ValidationError) return response.status(422).json({ type: "validation", message: error.message });
      next(error);
    }
  });
  app.post("/api/projects/:projectId/media/uploads", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      const ownerId = String(response.locals.ownerId);
      if (!await projects.get(ownerId, request.params.projectId)) {
        return response.status(404).json({ type: "not_found", message: "not found" });
      }
      const declaredType = String(request.body?.content_type ?? "");
      const maxBytes = Number(request.body?.bytes);
      if (!allowedMediaTypes.has(declaredType)
        || !Number.isInteger(maxBytes)
        || maxBytes <= 0
        || maxBytes > maximumMediaBytes) {
        return response.status(422).json({ type: "validation", message: "upload declaration rejected" });
      }
      const id = randomUUID();
      const objectKey = `projects/${request.params.projectId}/media/${id}`;
      await options.media.repository.insert({
        id,
        ownerId,
        projectId: request.params.projectId,
        objectKey,
        state: "admitted",
        declaredType,
        maxBytes
      });
      response.status(201).json({
        asset_id: id,
        method: "PUT",
        upload_url: await options.media.store.signedPut(objectKey, declaredType, maxBytes),
        expires_in_seconds: 300
      });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:projectId/media/:assetId/complete", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      const ownerId = String(response.locals.ownerId);
      const asset = await options.media.repository.get(ownerId, request.params.projectId, request.params.assetId);
      if (!asset) return response.status(404).json({ type: "not_found", message: "not found" });
      await options.media.store.exists(asset.objectKey);
      if (!await options.media.repository.completeAdmission(ownerId, request.params.projectId, asset.id)) {
        return response.status(409).json({ type: "conflict", message: "media is not admissible" });
      }
      response.status(202).json({ asset_id: asset.id, state: "inspecting" });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/projects/:projectId/media/:assetId", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      const ownerId = String(response.locals.ownerId);
      const asset = await options.media.repository.get(ownerId, request.params.projectId, request.params.assetId);
      if (!asset) return response.status(404).json({ type: "not_found", message: "not found" });
      response.json({ id: asset.id, state: asset.state });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/pexels/search", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      let query: string;
      try {
        query = pexelsQuery(request.query.q);
      } catch (error) {
        return response.status(422).json({
          type: "validation",
          message: error instanceof Error ? error.message : "invalid Pexels query"
        });
      }
      const results = await options.media.pexels.search(query);
      response.json({
        results: results.map(({ sourceUrl: _sourceUrl, contentType: _contentType, ...result }) => result)
      });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:projectId/media/pexels", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      const ownerId = String(response.locals.ownerId);
      if (!await projects.get(ownerId, request.params.projectId)) {
        return response.status(404).json({ type: "not_found", message: "not found" });
      }
      let query: string;
      try {
        query = pexelsQuery(request.body?.query);
      } catch (error) {
        return response.status(422).json({
          type: "validation",
          message: error instanceof Error ? error.message : "invalid Pexels query"
        });
      }
      const pexelsId = Number(request.body?.pexels_id);
      const selected = (await options.media.pexels.search(query)).find(({ id }) => id === pexelsId);
      if (!selected) return response.status(404).json({ type: "not_found", message: "Pexels result unavailable" });
      const asset = await options.media.pexels.copy(
        ownerId,
        request.params.projectId,
        selected,
        options.media.repository,
        options.media.store
      );
      response.status(201).json({ asset });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:projectId/render", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      if (!options.renders) return response.status(503).json({ type: "unavailable" });
      const job = await options.renders.create(ownerId, request.params.projectId);
      if (!job) return response.status(404).json({ type: "not_found", message: "not found" });
      response.status(202).json({
        job_id: job.jobId,
        project_id: job.projectId,
        revision: job.revision,
        state: job.state
      });
    } catch (error) {
      if (error instanceof RenderCapacityError) {
        return response.status(429).json({
          type: "render_capacity",
          message: "Finish or cancel an existing render before starting another."
        });
      }
      next(error);
    }
  });
  app.post("/api/render-jobs/:jobId/cancel", async (request, response, next) => {
    try {
      if (!options.renders) return response.status(503).json({ type: "unavailable" });
      const job = await options.renders.cancel(String(response.locals.ownerId), request.params.jobId);
      if (!job) return response.status(404).json({ type: "not_found", message: "not found" });
      response.json({ job_id: job.jobId, state: job.state });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/render-jobs/:jobId/events", async (request, response, next) => {
    try {
      if (!options.renders) return response.status(503).json({ type: "unavailable" });
      const ownerId = String(response.locals.ownerId);
      const jobId = request.params.jobId;
      let lastEventId = request.header("last-event-id") ?? "";
      const first = await options.renders.events(ownerId, jobId, lastEventId || undefined);
      if (!first) return response.status(404).json({ type: "not_found", message: "not found" });

      // ponytail: DB poll every 500ms while SSE open; ceiling 15m. Upgrade: LISTEN/NOTIFY.
      const terminal = new Set(["complete", "cancelled", "failed"]);
      response.setHeader("content-type", "text/event-stream");
      response.setHeader("cache-control", "no-cache");
      response.setHeader("connection", "keep-alive");

      let closed = false;
      request.on("close", () => {
        closed = true;
      });

      const writeEvents = (events: Array<{ eventId: string; phase: string; percent: number }>) => {
        for (const event of events) {
          response.write(`id: ${event.eventId}\nevent: progress\ndata: ${JSON.stringify({
            job_id: jobId,
            event_id: event.eventId,
            phase: event.phase,
            percent: event.percent
          })}\n\n`);
          lastEventId = event.eventId;
          if (terminal.has(event.phase)) return true;
        }
        return false;
      };

      if (writeEvents(first)) {
        response.end();
        return;
      }

      const deadline = Date.now() + 15 * 60_000;
      while (!closed && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (closed) break;
        const events = await options.renders.events(ownerId, jobId, lastEventId || undefined);
        if (!events) break;
        if (writeEvents(events)) {
          response.end();
          return;
        }
      }
      response.end();
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/render-jobs/:jobId/download", async (request, response, next) => {
    try {
      if (!options.renders || !options.media) return response.status(503).json({ type: "unavailable" });
      const result = await options.renders.result(String(response.locals.ownerId), request.params.jobId);
      if (!result) return response.status(404).json({ type: "not_found", message: "not found" });
      response.json({
        url: await options.media.store.signedGet(result.objectKey),
        expires_at: new Date(Date.now() + 300_000).toISOString()
      });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/download/:jobId", async (request, response, next) => {
    try {
      if (!options.renders || !options.media) return response.status(503).json({ type: "unavailable" });
      const result = await options.renders.result(String(response.locals.ownerId), request.params.jobId);
      if (!result) return response.status(404).json({ type: "not_found", message: "not found" });
      response.redirect(303, await options.media.store.signedGet(result.objectKey));
    } catch (error) { next(error); }
  });
  return app;
}

export function createApp(options: AppOptions) {
  return buildApp(options, (authorization) =>
    authenticateBearer(
      authorization,
      options.authConfig,
      options.accountState,
      options.ensureUser,
      options.accessPolicy
    ));
}

export function createTestApp(options: TestAppOptions = {}) {
  const ownerId = options.ownerId ?? "authenticated-user";
  const accountState = options.accountState ?? "active";
  return buildApp({ ...options, projects: options.projects ?? new ProjectService() }, async () => {
    assertAccountActive(accountState);
    return ownerId;
  });
}
