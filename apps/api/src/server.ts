import express from "express";
import { randomUUID } from "node:crypto";
import { conceptsFor } from "@f-motion/reel-engine";
import {
  AccountUnavailableError,
  UnauthorizedError,
  assertAccountActive,
  authenticateBearer,
  type AccountStateLookup,
  type AuthConfig
} from "./auth.js";
import {
  ConflictError,
  NotFoundError,
  ProjectService,
  RenderService,
  type ProjectRepository
} from "./domain.js";
import {
  allowedMediaTypes,
  maximumMediaBytes,
  type PexelsClient,
  type PostgresMediaRepository,
  type PrivateObjectStore
} from "./media-storage.js";

export interface MediaDependencies {
  repository: PostgresMediaRepository;
  store: PrivateObjectStore;
  pexels: PexelsClient;
  enqueueInspection(assetId: string, ownerId: string, projectId: string): Promise<void>;
}

interface AppBaseOptions {
  projects: ProjectRepository;
  media?: MediaDependencies;
  ready?: () => boolean;
  workerOrigin?: string;
}

export interface AppOptions extends AppBaseOptions {
  authConfig: AuthConfig;
  accountState: AccountStateLookup;
}

export interface TestAppOptions extends Omit<AppBaseOptions, "projects"> {
  ownerId?: string;
  accountState?: string;
  projects?: ProjectRepository;
}

type Identify = (authorization: string | undefined) => Promise<string>;

function buildApp(options: AppBaseOptions, identify: Identify) {
  const app = express();
  const projects = options.projects;
  const renders = new RenderService();
  const ready = options.ready ?? (() => true);
  const workerOrigin = options.workerOrigin ?? process.env.WORKER_ORIGIN;
  app.use(express.json());
  app.use((request, response, next) => {
    const requestId = request.header("x-request-id") || randomUUID();
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", (_request, response) => ready() ? response.json({ status: "ready" }) : response.status(503).json({ status: "unavailable" }));
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
  app.post("/api/projects", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      const brief = {
        purpose: String(request.body?.purpose || ""),
        audience: String(request.body?.audience || "Customers"),
        tone: String(request.body?.tone || "Warm")
      };
      const project = await projects.create(ownerId, brief);
      response.status(201).json({ project, concepts: conceptsFor(project.brief) });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/projects/:projectId/commands", async (request, response, next) => {
    const ownerId = String(response.locals.ownerId);
    try {
      response.json(await projects.command(ownerId, { ...request.body, project_id: request.params.projectId }));
    } catch (error) {
      if (error instanceof ConflictError) {
        return response.status(409).json({
          type: "conflict",
          message: error.message,
          authoritative_snapshot: error.authoritativeSnapshot
        });
      }
      if (error instanceof NotFoundError) return response.status(404).json({ type: "not_found", message: error.message });
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
        upload_url: await options.media.store.signedPut(objectKey, declaredType),
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
      if (!await options.media.repository.markInspecting(ownerId, request.params.projectId, asset.id)) {
        return response.status(409).json({ type: "conflict", message: "media is not admissible" });
      }
      await options.media.enqueueInspection(asset.id, ownerId, request.params.projectId);
      response.status(202).json({ asset_id: asset.id, state: "inspecting" });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/pexels/search", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      const query = String(request.query.q ?? "").trim();
      if (!query) return response.status(422).json({ type: "validation", message: "query required" });
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
      const query = String(request.body?.query ?? "").trim();
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
      const project = await projects.get(ownerId, request.params.projectId);
      if (!project || !workerOrigin) return response.status(503).json({ type: "unavailable" });
      const job = renders.create(ownerId, project.id, project.revision);
      const workerResponse = await fetch(`${workerOrigin}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId, projectId: project.id, revision: project.revision })
      });
      if (!workerResponse.ok) throw new Error("worker unavailable");
      const result = await workerResponse.json();
      response.status(202).json({ ...job, state: "complete", result });
    } catch (error) { next(error); }
  });
  app.get("/api/download/:jobId", async (request, response, next) => {
    try {
      if (!workerOrigin) return response.status(503).end();
      const workerResponse = await fetch(`${workerOrigin}/downloads/${request.params.jobId}`);
      if (!workerResponse.ok) return response.status(workerResponse.status).end();
      response.setHeader("content-type", "video/mp4");
      response.end(Buffer.from(await workerResponse.arrayBuffer()));
    } catch (error) { next(error); }
  });
  return app;
}

export function createApp(options: AppOptions) {
  return buildApp(options, (authorization) => authenticateBearer(authorization, options.authConfig, options.accountState));
}

export function createTestApp(options: TestAppOptions = {}) {
  const ownerId = options.ownerId ?? "authenticated-user";
  const accountState = options.accountState ?? "active";
  return buildApp({ ...options, projects: options.projects ?? new ProjectService() }, async () => {
    assertAccountActive(accountState);
    return ownerId;
  });
}
