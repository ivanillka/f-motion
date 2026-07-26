import express from "express";
import { randomUUID } from "node:crypto";

export function createApp(ready = () => true) {
  const app = express();
  app.use((request, response, next) => {
    const requestId = request.header("x-request-id") || randomUUID();
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  app.get("/readyz", (_request, response) => ready() ? response.json({ status: "ready" }) : response.status(503).json({ status: "unavailable" }));
  return app;
}

if (process.env.NODE_ENV !== "test") {
  createApp().listen(Number(process.env.PORT ?? 3000));
}
