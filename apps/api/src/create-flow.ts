import type { Express, Response } from "express";
import { TypeRegistry } from "@f-engine/content-type-contract";
import {
  CraftDispatcher,
  Gate0Error,
  Gate0Policy,
  MemoryCreateSessionStore,
  poolSeam,
  questionSeam,
  settingsSeam,
  type ByokKeyPresence
} from "@f-engine/create-session";
import { registerReelVertical } from "@f-engine/type-reel-vertical";
import type { FalCredentialService } from "./fal-credentials.js";
import type { PexelsCredentialService } from "./pexels-credentials.js";

export function createDefaultTypeRegistry(): TypeRegistry {
  const registry = new TypeRegistry();
  // One module at a time — reel only until the next polish-ready craft ships.
  registerReelVertical(registry);
  return registry;
}

export interface CreateFlowServices {
  registry: TypeRegistry;
  store: MemoryCreateSessionStore;
  dispatcherFor(keys: ByokKeyPresence): CraftDispatcher;
}

export function createFlowServices(): CreateFlowServices {
  const registry = createDefaultTypeRegistry();
  const store = new MemoryCreateSessionStore();
  return {
    registry,
    store,
    dispatcherFor(keys) {
      return new CraftDispatcher(registry, new Gate0Policy(keys));
    }
  };
}

export type CreateFlowMountOptions = {
  pexelsCredentials?: PexelsCredentialService;
  falCredentials?: FalCredentialService;
  services?: CreateFlowServices;
};

function sendCreateFlowError(response: Response, error: unknown): boolean {
  if (error instanceof Gate0Error) {
    response.status(403).json({ type: "gate0", message: error.message });
    return true;
  }
  if (error instanceof Error && /unknown create session/u.test(error.message)) {
    response.status(404).json({ type: "not_found", message: error.message });
    return true;
  }
  if (
    error instanceof Error
    && /not polish-ready|no polish-ready|media required|unknown typeId|bad settings|reel |durationSeconds|invalid /u.test(error.message)
  ) {
    response.status(400).json({ type: "validation", message: error.message });
    return true;
  }
  return false;
}

async function byokKeys(
  ownerId: string,
  options: CreateFlowMountOptions
): Promise<ByokKeyPresence> {
  const [pexels, fal] = await Promise.all([
    options.pexelsCredentials?.status(ownerId).then((view) => view.connected).catch(() => false) ?? Promise.resolve(false),
    options.falCredentials?.status(ownerId).then((view) => view.connected).catch(() => false) ?? Promise.resolve(false)
  ]);
  return { pexels, fal };
}

/**
 * Thin create-flow HTTP seams. Pool/Qs UX stays client-side for now;
 * sessions are in-memory; craft fans out only through TypeRegistry.
 */
export function mountCreateFlowRoutes(app: Express, options: CreateFlowMountOptions = {}): CreateFlowServices {
  const services = options.services ?? createFlowServices();
  const { registry, store } = services;

  app.get("/api/content-types", (_request, response) => {
    response.json({ types: settingsSeam.polishReadyTypes(registry) });
  });

  app.post("/api/create-sessions", (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      const body = (request.body ?? {}) as { skipPool?: boolean; brief?: Record<string, string> };
      let session = poolSeam.start(ownerId, { skipPool: body.skipPool === true });
      if (body.brief) session = questionSeam.answer(session, body.brief);
      store.put(session);
      response.status(201).json({ session });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  app.get("/api/create-sessions/:sessionId", (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      const session = store.require(String(request.params.sessionId));
      if (session.ownerId !== ownerId) {
        response.status(404).json({ type: "not_found", message: "not found" });
        return;
      }
      response.json({ session });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  app.post("/api/create-sessions/:sessionId/pool/skip", (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      let session = store.require(String(request.params.sessionId));
      if (session.ownerId !== ownerId) {
        response.status(404).json({ type: "not_found", message: "not found" });
        return;
      }
      session = poolSeam.skip(session);
      store.put(session);
      response.json({ session, questionPath: questionSeam.pathFor(session) });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  app.post("/api/create-sessions/:sessionId/pool/items", (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      let session = store.require(String(request.params.sessionId));
      if (session.ownerId !== ownerId) {
        response.status(404).json({ type: "not_found", message: "not found" });
        return;
      }
      const items = Array.isArray((request.body as { items?: unknown })?.items)
        ? (request.body as { items: Array<{ id: string; kind?: "image" | "video"; score?: number }> }).items
        : [];
      session = poolSeam.admit(session, items.map((item) => ({
        id: String(item.id),
        ...(item.kind ? { kind: item.kind } : {}),
        ...(typeof item.score === "number" ? { score: item.score } : {})
      })));
      store.put(session);
      response.json({ session });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  app.patch("/api/create-sessions/:sessionId/brief", (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      let session = store.require(String(request.params.sessionId));
      if (session.ownerId !== ownerId) {
        response.status(404).json({ type: "not_found", message: "not found" });
        return;
      }
      session = questionSeam.answer(session, (request.body ?? {}) as Record<string, string>);
      store.put(session);
      response.json({ session });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  app.patch("/api/create-sessions/:sessionId/settings", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      let session = store.require(String(request.params.sessionId));
      if (session.ownerId !== ownerId) {
        response.status(404).json({ type: "not_found", message: "not found" });
        return;
      }
      const body = (request.body ?? {}) as {
        selectedTypeIds?: string[];
        typeSettings?: Record<string, unknown>;
        mediaSourcePref?: "own" | "pexels" | "fal" | "mix" | "defer";
      };
      const keys = await byokKeys(ownerId, options);
      const gate = new Gate0Policy(keys);
      if (body.mediaSourcePref) gate.assertMediaSourcePref(body.mediaSourcePref);
      const reelSettings = body.typeSettings?.reel_vertical;
      if (
        reelSettings
        && typeof reelSettings === "object"
        && !Array.isArray(reelSettings)
        && (reelSettings as { animateStills?: unknown }).animateStills === true
      ) {
        // Animate stills spends FAL — never claim managed AI.
        gate.requireByok("fal");
      }
      session = settingsSeam.apply(session, body, registry);
      store.put(session);
      response.json({ session });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  app.post("/api/create-sessions/:sessionId/generate", async (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      let session = store.require(String(request.params.sessionId));
      if (session.ownerId !== ownerId) {
        response.status(404).json({ type: "not_found", message: "not found" });
        return;
      }
      const dispatcher = services.dispatcherFor(await byokKeys(ownerId, options));
      session = await dispatcher.runAll(session);
      store.put(session);
      response.json({ session });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  app.get("/api/create-sessions/:sessionId/artifacts", (request, response, next) => {
    try {
      const ownerId = String(response.locals.ownerId);
      const session = store.require(String(request.params.sessionId));
      if (session.ownerId !== ownerId) {
        response.status(404).json({ type: "not_found", message: "not found" });
        return;
      }
      response.json({ artifacts: session.artifacts });
    } catch (error) {
      if (!sendCreateFlowError(response, error)) next(error);
    }
  });

  return services;
}
