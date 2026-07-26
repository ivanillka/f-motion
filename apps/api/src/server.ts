import express from "express";
import { randomUUID } from "node:crypto";
import {
  AccountUnavailableError,
  UnauthorizedError,
  assertAccountActive,
  authenticateBearer,
  type AccountStateLookup,
  type AuthConfig
} from "./auth.js";
import { ProjectService, RenderService } from "./domain.js";

interface AppBaseOptions {
  ready?: () => boolean;
  workerOrigin?: string;
}

export interface AppOptions extends AppBaseOptions {
  authConfig: AuthConfig;
  accountState: AccountStateLookup;
}

export interface TestAppOptions extends AppBaseOptions {
  ownerId?: string;
  accountState?: string;
}

type Identify = (authorization: string | undefined) => Promise<string>;

function buildApp(options: AppBaseOptions, identify: Identify) {
  const app = express();
  const projects = new ProjectService();
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
  app.post("/api/projects", (request, response) => {
    const ownerId = String(response.locals.ownerId);
    const brief = {
      purpose: String(request.body?.purpose || ""),
      audience: String(request.body?.audience || "Customers"),
      tone: String(request.body?.tone || "Warm")
    };
    const project = projects.create(ownerId, brief);
    response.status(201).json({ project, concepts: projects.concepts(ownerId, project.id) });
  });
  app.post("/api/projects/:projectId/commands", (request, response) => {
    const ownerId = String(response.locals.ownerId);
    try {
      response.json(projects.command(ownerId, { ...request.body, project_id: request.params.projectId }));
    } catch (error) {
      response.status(409).json({ type: "conflict", message: String(error) });
    }
  });
  app.post("/api/projects/:projectId/render", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      const project = projects.get(ownerId, request.params.projectId);
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
  return buildApp(options, async () => {
    assertAccountActive(accountState);
    return ownerId;
  });
}
