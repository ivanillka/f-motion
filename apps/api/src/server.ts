import express from "express";
import { randomUUID } from "node:crypto";
import { ProjectService, RenderService } from "./domain.js";

export function createApp(ready = () => true, workerOrigin = process.env.WORKER_ORIGIN) {
  const app = express();
  const projects = new ProjectService();
  const renders = new RenderService();
  app.use(express.json());
  app.use((request, response, next) => {
    const requestId = request.header("x-request-id") || randomUUID();
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", (_request, response) => ready() ? response.json({ status: "ready" }) : response.status(503).json({ status: "unavailable" }));
  app.post("/api/projects", (request, response) => {
    const ownerId = String(request.header("x-test-owner") || "authenticated-user");
    const brief = {
      purpose: String(request.body?.purpose || ""),
      audience: String(request.body?.audience || "Customers"),
      tone: String(request.body?.tone || "Warm")
    };
    const project = projects.create(ownerId, brief);
    response.status(201).json({ project, concepts: projects.concepts(ownerId, project.id) });
  });
  app.post("/api/projects/:projectId/commands", (request, response) => {
    const ownerId = String(request.header("x-test-owner") || "authenticated-user");
    try {
      response.json(projects.command(ownerId, { ...request.body, project_id: request.params.projectId }));
    } catch (error) {
      response.status(409).json({ type: "conflict", message: String(error) });
    }
  });
  app.post("/api/projects/:projectId/render", async (request, response, next) => {
    try {
      const ownerId = String(request.header("x-test-owner") || "authenticated-user");
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
