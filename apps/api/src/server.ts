import express from "express";
import { randomUUID } from "node:crypto";
import { buildStoryboardDraft, conceptsFor } from "@f-engine/reel-engine";
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
  ExternalMediaImportError,
  importExternalMedia,
  maximumMediaBytes,
  pexelsQueriesForBrief,
  sceneMediaView,
  PexelsRequestError,
  type PexelsClient,
  type PostgresMediaRepository,
  type PrivateObjectStore
} from "./media-storage.js";
import {
  PostgresRenderRepository,
  RenderCapacityError,
  RenderInputIncompleteError,
  type RenderKind
} from "./render-repository.js";
import type { AccessPolicy } from "./access-policy.js";
import {
  falCredentialHttpError,
  type FalCredentialService
} from "./fal-credentials.js";
import {
  falGenerationHttpError,
  type FalGenerationService
} from "./fal-generation.js";
import {
  PexelsProviderError,
  pexelsCredentialHttpError,
  type PexelsCredentialService
} from "./pexels-credentials.js";
import {
  authenticatesExternalImport,
  externalMediaUrlAllowed,
  externalProjectUrl,
  mediaIdForExternalImport,
  parseExternalDraft,
  projectIdForExternalImport,
  type ExternalImportConfig
} from "./external-import.js";

export interface MediaDependencies {
  repository: PostgresMediaRepository;
  store: PrivateObjectStore;
  pexelsForOwner?: (ownerId: string) => Promise<PexelsClient>;
  /** Test/local adapter only; hosted startup never constructs a shared client. */
  pexels?: PexelsClient;
}

interface AppBaseOptions {
  projects: ProjectRepository;
  media?: MediaDependencies;
  renders?: PostgresRenderRepository;
  ready?: () => boolean | Promise<boolean>;
  workerOrigin?: string;
  externalImports?: ExternalImportConfig;
  /** Test adapter for trusted remote-media imports. */
  externalMediaRequest?: typeof fetch;
  falCredentials?: FalCredentialService;
  falGeneration?: FalGenerationService;
  pexelsCredentials?: PexelsCredentialService;
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
  const candidates = command.kind === "replace_storyboard"
    ? command.payload.scenes
    : ["update_scene", "add_scene"].includes(command.kind)
      ? [command.payload.scene]
      : [];
  if (!Array.isArray(candidates)) return;
  for (const scene of candidates) {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) continue;
    const mediaId = (scene as { media_id?: unknown }).media_id;
    if (mediaId === undefined || mediaId === null) continue;
    if (typeof mediaId !== "string" || !mediaId) throw new ValidationError("media_id invalid");
    if (!media?.repository) throw new ValidationError("media_id not ready");
    const asset = await media.repository.get(ownerId, command.project_id, mediaId);
    if (!asset || asset.state !== "ready") throw new ValidationError("media_id not ready");
  }
}

function commandEnvelope(value: unknown, projectId: string): CommandEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("invalid command");
  const command = value as Record<string, unknown>;
  if (typeof command.command_id !== "string"
    || !command.command_id
    || !Number.isInteger(command.base_revision)
    || typeof command.client_timestamp !== "string"
    || !["select_concept", "update_scene", "reorder_scene", "replace_storyboard", "add_scene", "remove_scene"].includes(String(command.kind))
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
  // Compatibility: /v1/* executes the same handlers as /api/* (auth + routes).
  app.use((request, _response, next) => {
    const url = request.url;
    if (url === "/v1" || url.startsWith("/v1/") || url.startsWith("/v1?")) {
      request.url = `/api${url.slice(3)}`;
    }
    next();
  });
  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", async (_request, response) => {
    const isReady = await Promise.resolve(ready()).catch(() => false);
    if (isReady) return response.json({ status: "ready" });
    response.status(503).json({ status: "unavailable" });
  });
  const integration = options.externalImports;
  if (integration) app.post("/api/integrations/project-imports", async (request, response, next) => {
    if (!authenticatesExternalImport(request.header("authorization"), integration.token)) {
      return response.status(401).json({ type: "unauthorized", message: "authentication required" });
    }
    try {
      const draft = parseExternalDraft(request.body);
      const projectId = projectIdForExternalImport(integration.ownerId, draft.externalId);
      const prior = await projects.get(integration.ownerId, projectId);
      let project = await projects.create(integration.ownerId, draft.brief, projectId);
      const generatedScenes = buildStoryboardDraft(draft.brief.purpose, randomUUID, draft.architecture, draft.source);
      const importedMediaIds: string[] = [];
      if (draft.mediaUrls.length) {
        if (!options.media) return response.status(503).json({ type: "unavailable", message: "media import unavailable" });
        if (draft.mediaUrls.some((url) => !externalMediaUrlAllowed(url, integration.mediaOrigins))) {
          return response.status(422).json({ type: "validation", message: "media origin is not allowed" });
        }
        for (const url of draft.mediaUrls.slice(0, generatedScenes.length)) {
          const id = mediaIdForExternalImport(projectId, url);
          await importExternalMedia(
            integration.ownerId,
            projectId,
            id,
            url,
            options.media.repository,
            options.media.store,
            options.externalMediaRequest
          );
          importedMediaIds.push(id);
        }
      }
      const textOnlyImportedDraft = project.scenes.length > 0 && project.scenes.every((scene) => !scene.media_id);
      const legacyAutoPrompts = project.scenes.length > 0 && project.scenes.every((scene) =>
        scene.visual_prompt === "Selected gallery media"
          || scene.visual_prompt?.startsWith("Selected gallery image ")
          || scene.visual_prompt?.startsWith("use secondary image"));
      const legacyMediaRepair = project.scenes.length > 0
        && project.scenes.every((scene) => scene.media_id)
        && legacyAutoPrompts
        && project.scenes.some((scene) => scene.caption.includes("https://") || scene.visual_prompt?.startsWith("use secondary image"));
      const rebuildImportedDraft = textOnlyImportedDraft || legacyMediaRepair;
      const currentScenes = rebuildImportedDraft
        ? generatedScenes.map((scene, index) => ({
            ...scene,
            ...(project.scenes[index]?.id ? { id: project.scenes[index].id } : {}),
            ...(project.scenes[index]?.media_id ? { media_id: project.scenes[index].media_id } : {})
          }))
        : project.scenes.length ? project.scenes : generatedScenes;
      const scenes = currentScenes.map((scene, index) => {
        const mediaId = importedMediaIds[index % importedMediaIds.length];
        return mediaId && (!scene.media_id || rebuildImportedDraft || !project.scenes.length)
          ? { ...scene, media_id: mediaId, visual_prompt: `Selected gallery image ${index + 1}` }
          : scene;
      });
      const storyboardChanged = scenes.length !== project.scenes.length || scenes.some((scene, index) => {
        const priorScene = project.scenes[index];
        return scene.media_id !== priorScene?.media_id
          || scene.caption !== priorScene?.caption
          || scene.visual_prompt !== priorScene?.visual_prompt;
      });
      if (!project.scenes.length || storyboardChanged) {
        project = await projects.command(integration.ownerId, {
          command_id: randomUUID(),
          project_id: project.id,
          base_revision: project.revision,
          client_timestamp: new Date().toISOString(),
          kind: "replace_storyboard",
          payload: { scenes }
        });
      }
      response.status(prior ? 200 : 201).json({
        created: !prior,
        project_id: project.id,
        project_url: externalProjectUrl(integration.webOrigin, project.id),
        revision: project.revision
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid ")) {
        return response.status(422).json({ type: "validation", message: error.message });
      }
      if (error instanceof ExternalMediaImportError) {
        return response.status(502).json({ type: "upstream", message: "existing media could not be imported" });
      }
      next(error);
    }
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
  const falUnavailable = (response: express.Response) => response.status(503).json({
    type: "provider_unavailable",
    message: "FAL connection is not enabled on this deployment."
  });
  const exactObject = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const actual = Object.keys(value as Record<string, unknown>);
    return actual.length === keys.length && keys.every((key) => actual.includes(key));
  };
  const emptyBody = (value: unknown) => value === undefined || exactObject(value, []);
  const pexelsForOwner = async (media: MediaDependencies, ownerId: string) => {
    if (media.pexelsForOwner) return media.pexelsForOwner(ownerId);
    if (media.pexels) return media.pexels;
    throw new PexelsProviderError("unavailable");
  };
  const pexelsHttpError = (error: unknown) => pexelsCredentialHttpError(error)
    ?? (error instanceof PexelsRequestError
      ? { status: 503, body: { type: "provider_unavailable", message: "Pexels could not be reached. Try again later." } }
      : undefined);
  app.get("/api/providers/fal/credential", async (_request, response, next) => {
    try {
      if (!options.falCredentials) return falUnavailable(response);
      response.json(await options.falCredentials.status(String(response.locals.ownerId)));
    } catch (error) { next(error); }
  });
  app.put("/api/providers/fal/credential", async (request, response, next) => {
    try {
      if (!options.falCredentials) return falUnavailable(response);
      if (!exactObject(request.body, ["api_key"])) {
        return response.status(422).json({ type: "validation", message: "Enter a valid FAL API key." });
      }
      response.json(await options.falCredentials.connect(
        String(response.locals.ownerId),
        (request.body as { api_key?: unknown }).api_key
      ));
    } catch (error) {
      const mapped = falCredentialHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/providers/fal/credential/test", async (request, response, next) => {
    try {
      if (!options.falCredentials) return falUnavailable(response);
      if (!emptyBody(request.body)) {
        return response.status(422).json({ type: "validation", message: "This request does not accept fields." });
      }
      response.json(await options.falCredentials.test(String(response.locals.ownerId)));
    } catch (error) {
      const mapped = falCredentialHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.delete("/api/providers/fal/credential", async (request, response, next) => {
    try {
      if (!options.falCredentials) return falUnavailable(response);
      if (!emptyBody(request.body)) {
        return response.status(422).json({ type: "validation", message: "This request does not accept fields." });
      }
      await options.falCredentials.disconnect(String(response.locals.ownerId));
      response.status(204).end();
    } catch (error) { next(error); }
  });
  const pexelsUnavailable = (response: express.Response) => response.status(503).json({
    type: "provider_unavailable",
    message: "Pexels connection is not enabled on this deployment."
  });

  const falGenUnavailable = (response: import("express").Response) =>
    response.status(503).json({ type: "provider_unavailable", message: "FAL generation is not enabled on this deployment." });
  app.post("/api/projects/:projectId/scenes/:sceneId/fal/image-quotes", async (request, response, next) => {
    try {
      if (!options.falGeneration) return falGenUnavailable(response);
      if (!exactObject(request.body, ["prompt"])) {
        return response.status(422).json({ type: "validation", message: "invalid prompt" });
      }
      const job = await options.falGeneration.quoteImage(
        String(response.locals.ownerId),
        request.params.projectId,
        request.params.sceneId,
        (request.body as { prompt?: unknown }).prompt
      );
      response.status(201).json(job);
    } catch (error) {
      const mapped = falGenerationHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/projects/:projectId/scenes/:sceneId/fal/video-quotes", async (request, response, next) => {
    try {
      if (!options.falGeneration) return falGenUnavailable(response);
      if (!exactObject(request.body, ["source_media_id", "motion_prompt"])) {
        return response.status(422).json({ type: "validation", message: "invalid video quote" });
      }
      const body = request.body as { source_media_id?: unknown; motion_prompt?: unknown };
      const job = await options.falGeneration.quoteVideo(
        String(response.locals.ownerId),
        request.params.projectId,
        request.params.sceneId,
        body.source_media_id,
        body.motion_prompt
      );
      response.status(201).json(job);
    } catch (error) {
      const mapped = falGenerationHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/generation-jobs/:jobId/confirm", async (request, response, next) => {
    try {
      if (!options.falGeneration) return falGenUnavailable(response);
      if (!exactObject(request.body, ["idempotency_key"])) {
        return response.status(422).json({ type: "validation", message: "invalid idempotency key" });
      }
      response.json(await options.falGeneration.confirm(
        String(response.locals.ownerId),
        request.params.jobId,
        (request.body as { idempotency_key?: unknown }).idempotency_key
      ));
    } catch (error) {
      const mapped = falGenerationHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.get("/api/generation-jobs/:jobId", async (_request, response, next) => {
    try {
      if (!options.falGeneration) return falGenUnavailable(response);
      const job = await options.falGeneration.get(String(response.locals.ownerId), _request.params.jobId);
      if (!job) return response.status(404).json({ type: "not_found", message: "not found" });
      response.json(job);
    } catch (error) {
      const mapped = falGenerationHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/generation-jobs/:jobId/cancel", async (request, response, next) => {
    try {
      if (!options.falGeneration) return falGenUnavailable(response);
      if (!emptyBody(request.body)) {
        return response.status(422).json({ type: "validation", message: "This request does not accept fields." });
      }
      response.json(await options.falGeneration.cancel(String(response.locals.ownerId), request.params.jobId));
    } catch (error) {
      const mapped = falGenerationHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.get("/api/providers/pexels/credential", async (_request, response, next) => {
    try {
      if (!options.pexelsCredentials) return pexelsUnavailable(response);
      response.json(await options.pexelsCredentials.status(String(response.locals.ownerId)));
    } catch (error) { next(error); }
  });
  app.put("/api/providers/pexels/credential", async (request, response, next) => {
    try {
      if (!options.pexelsCredentials) return pexelsUnavailable(response);
      if (!exactObject(request.body, ["api_key"])) {
        return response.status(422).json({ type: "validation", message: "Enter a valid Pexels API key." });
      }
      response.json(await options.pexelsCredentials.connect(
        String(response.locals.ownerId),
        (request.body as { api_key?: unknown }).api_key
      ));
    } catch (error) {
      const mapped = pexelsHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/providers/pexels/credential/test", async (request, response, next) => {
    try {
      if (!options.pexelsCredentials) return pexelsUnavailable(response);
      if (!emptyBody(request.body)) {
        return response.status(422).json({ type: "validation", message: "This request does not accept fields." });
      }
      response.json(await options.pexelsCredentials.test(String(response.locals.ownerId)));
    } catch (error) {
      const mapped = pexelsHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.delete("/api/providers/pexels/credential", async (request, response, next) => {
    try {
      if (!options.pexelsCredentials) return pexelsUnavailable(response);
      if (!emptyBody(request.body)) {
        return response.status(422).json({ type: "validation", message: "This request does not accept fields." });
      }
      await options.pexelsCredentials.disconnect(String(response.locals.ownerId));
      response.status(204).end();
    } catch (error) { next(error); }
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
      const quarantineObjectKey = `projects/${request.params.projectId}/media-quarantine/${id}`;
      await options.media.repository.insert({
        id,
        ownerId,
        projectId: request.params.projectId,
        quarantineObjectKey,
        state: "admitted",
        declaredType,
        maxBytes
      });
      response.status(201).json({
        asset_id: id,
        method: "PUT",
        upload_url: await options.media.store.signedPut(quarantineObjectKey, declaredType, maxBytes),
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
      await options.media.store.exists(asset.quarantineObjectKey);
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
      const previewUrl = asset.state === "ready" && asset.sealedObjectKey
        ? await options.media.store.signedGet(asset.sealedObjectKey)
        : undefined;
      response.json(sceneMediaView(asset, previewUrl));
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
      const ownerId = String(response.locals.ownerId);
      const results = await (await pexelsForOwner(options.media, ownerId)).search(query);
      response.json({
        results: results.map(({ sourceUrl: _sourceUrl, contentType: _contentType, ...result }) => result)
      });
    } catch (error) {
      const mapped = pexelsHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
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
      const pexels = await pexelsForOwner(options.media, ownerId);
      const selected = (await pexels.search(query)).find(({ id }) => id === pexelsId);
      if (!selected) return response.status(404).json({ type: "not_found", message: "Pexels result unavailable" });
      const asset = await pexels.copy(
        ownerId,
        request.params.projectId,
        selected,
        options.media.repository,
        options.media.store
      );
      response.status(201).json({ asset: sceneMediaView(asset) });
    } catch (error) {
      const mapped = pexelsHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/projects/:projectId/media/pexels/auto", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      const ownerId = String(response.locals.ownerId);
      const project = await projects.get(ownerId, request.params.projectId);
      if (!project) return response.status(404).json({ type: "not_found", message: "not found" });
      const description = request.body?.description === undefined
        ? project.brief.purpose
        : projectBrief({ purpose: request.body.description }).purpose;

      const pexels = await pexelsForOwner(options.media, ownerId);
      let selected: Awaited<ReturnType<PexelsClient["search"]>>[number] | undefined;
      let matchedQuery = "";
      for (const query of pexelsQueriesForBrief(description)) {
        const [result] = await pexels.search(query);
        if (!result) continue;
        selected = result;
        matchedQuery = query;
        break;
      }
      if (!selected) {
        return response.status(404).json({
          type: "not_found",
          message: "No licensed stock matched this description"
        });
      }

      const asset = await pexels.copy(
        ownerId,
        request.params.projectId,
        selected,
        options.media.repository,
        options.media.store
      );
      const { sourceUrl: _sourceUrl, contentType: _contentType, ...match } = selected;
      response.status(201).json({ asset: sceneMediaView(asset), match, query: matchedQuery });
    } catch (error) {
      const mapped = pexelsHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/projects/:projectId/media/pexels/storyboard", async (request, response, next) => {
    try {
      if (!options.media) return response.status(503).json({ type: "unavailable" });
      const ownerId = String(response.locals.ownerId);
      const project = await projects.get(ownerId, request.params.projectId);
      if (!project) return response.status(404).json({ type: "not_found", message: "not found" });
      if (!project.scenes.length) {
        return response.status(422).json({ type: "validation", message: "storyboard has no scenes" });
      }
      const exclude = new Set<number>();
      if (request.body && typeof request.body === "object" && !Array.isArray(request.body)
        && Array.isArray((request.body as { exclude_pexels_ids?: unknown }).exclude_pexels_ids)) {
        for (const id of (request.body as { exclude_pexels_ids: unknown[] }).exclude_pexels_ids) {
          if (Number.isInteger(id) && Number(id) > 0) exclude.add(Number(id));
        }
      }
      const pexels = await pexelsForOwner(options.media, ownerId);
      const usedPexelsIds = new Set(exclude);
      const results: Array<{
        scene_id: string;
        state: "matched" | "no_result" | "skipped";
        asset?: ReturnType<typeof sceneMediaView>;
        match?: Omit<Awaited<ReturnType<PexelsClient["search"]>>[number], "sourceUrl" | "contentType">;
        query?: string;
        message?: string;
      }> = [];
      // Sequential on purpose: uniqueness across scenes depends on prior picks.
      for (const scene of [...project.scenes].sort((a, b) => a.order - b.order)) {
        if (scene.media_id) {
          results.push({ scene_id: scene.id, state: "skipped", message: "scene already has media" });
          continue;
        }
        const description = scene.visual_prompt?.trim() || scene.caption.trim() || project.brief.purpose;
        let selected: Awaited<ReturnType<PexelsClient["search"]>>[number] | undefined;
        let matchedQuery = "";
        let fallback: Awaited<ReturnType<PexelsClient["search"]>>[number] | undefined;
        let fallbackQuery = "";
        for (const query of pexelsQueriesForBrief(description)) {
          const hits = await pexels.search(query);
          const unused = hits.find((hit) => !usedPexelsIds.has(hit.id));
          if (unused) {
            selected = unused;
            matchedQuery = query;
            break;
          }
          if (!fallback && hits[0]) {
            fallback = hits[0];
            fallbackQuery = query;
          }
        }
        selected ??= fallback;
        matchedQuery ||= fallbackQuery;
        if (!selected) {
          results.push({
            scene_id: scene.id,
            state: "no_result",
            message: "No licensed stock matched this scene"
          });
          continue;
        }
        usedPexelsIds.add(selected.id);
        const asset = await pexels.copy(
          ownerId,
          request.params.projectId,
          selected,
          options.media.repository,
          options.media.store
        );
        const { sourceUrl: _sourceUrl, contentType: _contentType, ...match } = selected;
        results.push({
          scene_id: scene.id,
          state: "matched",
          asset: sceneMediaView(asset),
          match,
          query: matchedQuery
        });
      }
      response.status(200).json({ results });
    } catch (error) {
      const mapped = pexelsHttpError(error);
      if (mapped) return response.status(mapped.status).json(mapped.body);
      next(error);
    }
  });
  app.post("/api/projects/:projectId/render", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      if (!options.renders) return response.status(503).json({ type: "unavailable" });
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)
        || !["preview", "final"].includes(String(request.body.kind))
        || Object.keys(request.body).some((key) => key !== "kind")) {
        return response.status(422).json({ type: "validation", message: "invalid render kind" });
      }
      const job = await options.renders.create(ownerId, request.params.projectId, request.body.kind as RenderKind);
      if (!job) return response.status(404).json({ type: "not_found", message: "not found" });
      response.status(202).json({
        job_id: job.jobId,
        project_id: job.projectId,
        revision: job.revision,
        kind: job.kind,
        state: job.state
      });
    } catch (error) {
      if (error instanceof RenderCapacityError) {
        return response.status(429).json({
          type: "render_capacity",
          message: "Finish or cancel an existing render before starting another."
        });
      }
      if (error instanceof RenderInputIncompleteError) {
        return response.status(422).json({
          type: "render_input_incomplete",
          message: error.message
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
        expires_at: new Date(Date.now() + 300_000).toISOString(),
        kind: result.kind,
        stale: result.stale,
        metadata: Object.fromEntries(Object.entries(result.metadata).filter(([key, value]) =>
          ["width", "height", "duration_ms", "video_codec", "pixel_format", "audio_codec", "audio_channels", "audio_status", "scene_count", "revision"].includes(key)
          && (["string", "number", "boolean"].includes(typeof value) || value === null)))
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
