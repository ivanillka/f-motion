import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ProjectService } from "../dist/domain.js";
import { createApp, createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function fixture({ provision = false } = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const jwksServer = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  const jwksOrigin = await listen(jwksServer);
  const states = new Map([["active-owner", "active"], ["suspended-owner", "suspended"]]);
  let insertCalls = 0;
  const ensureUser = provision
    ? async (ownerId) => {
      insertCalls += 1;
      if (!states.has(ownerId)) states.set(ownerId, "active");
    }
    : undefined;
  const app = createApp({
    projects: new ProjectService(),
    authConfig: {
      issuer: "https://issuer.example",
      audience: "f-motion",
      jwksUrl: new URL("/jwks", jwksOrigin)
    },
    accountState: async (ownerId) => states.get(ownerId),
    ensureUser
  });
  const apiServer = createServer(app);
  const apiOrigin = await listen(apiServer);
  const token = (subject) => new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://issuer.example")
    .setAudience("f-motion")
    .setSubject(subject)
    .setExpirationTime("5m")
    .sign(privateKey);
  return {
    apiOrigin,
    token,
    states,
    insertCalls: () => insertCalls,
    close: async () => {
      await Promise.all([
        new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve())),
        new Promise((resolve, reject) => jwksServer.close((error) => error ? reject(error) : resolve()))
      ]);
    }
  };
}

test("all API routes reject requests without a Bearer token", async () => {
  const context = await fixture();
  try {
    const requests = [
      [`${context.apiOrigin}/api/projects`, { method: "POST" }],
      [`${context.apiOrigin}/api/projects/project/commands`, { method: "POST" }],
      [`${context.apiOrigin}/api/projects/project/render`, { method: "POST" }],
      [`${context.apiOrigin}/api/download/job`, undefined]
    ];
    for (const [url, options] of requests) {
      assert.equal((await fetch(url, options)).status, 401);
    }
    assert.equal((await fetch(`${context.apiOrigin}/healthz`)).status, 200);
  } finally {
    await context.close();
  }
});

test("verified active subject owns the route and headers cannot replace it", async () => {
  const context = await fixture();
  try {
    const response = await fetch(`${context.apiOrigin}/api/projects`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await context.token("active-owner")}`,
        "content-type": "application/json",
        "x-test-owner": "spoofed-owner"
      },
      body: JSON.stringify({ purpose: "Test" })
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).project.owner_id, "active-owner");
  } finally {
    await context.close();
  }
});

test("inactive and missing accounts are forbidden after token verification", async () => {
  const context = await fixture();
  try {
    for (const subject of ["suspended-owner", "missing-owner"]) {
      const response = await fetch(`${context.apiOrigin}/api/projects`, {
        method: "POST",
        headers: { authorization: `Bearer ${await context.token(subject)}` }
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).type, "forbidden");
    }
  } finally {
    await context.close();
  }
});

test("first verified JWT for an unknown subject provisions an active User row", async () => {
  const context = await fixture({ provision: true });
  try {
    const response = await fetch(`${context.apiOrigin}/api/projects`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await context.token("new-owner")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ purpose: "Test" })
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).project.owner_id, "new-owner");
    assert.equal(context.states.get("new-owner"), "active");
    assert.equal(context.insertCalls(), 1);

    const second = await fetch(`${context.apiOrigin}/api/projects`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await context.token("new-owner")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ purpose: "Test" })
    });
    assert.equal(second.status, 201);
    assert.equal(context.insertCalls(), 1, "ensureUser must not run again once the User row exists");
  } finally {
    await context.close();
  }
});

test("provisioning never reactivates a suspended or deletion-pending account", async () => {
  const context = await fixture({ provision: true });
  try {
    const response = await fetch(`${context.apiOrigin}/api/projects`, {
      method: "POST",
      headers: { authorization: `Bearer ${await context.token("suspended-owner")}` }
    });
    assert.equal(response.status, 403);
    assert.equal(context.insertCalls(), 0, "ensureUser must not run for an already-known account");
    assert.equal(context.states.get("suspended-owner"), "suspended");
  } finally {
    await context.close();
  }
});

test("an invalid JWT is rejected without provisioning a User row", async () => {
  const context = await fixture({ provision: true });
  try {
    const response = await fetch(`${context.apiOrigin}/api/projects`, {
      method: "POST",
      headers: { authorization: "Bearer not-a-real-token" }
    });
    assert.equal(response.status, 401);
    assert.equal(context.insertCalls(), 0);
  } finally {
    await context.close();
  }
});

test("explicit test app adapter injects only its configured identity", async () => {
  const server = createServer(createTestApp({ ownerId: "test-owner" }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/projects`, { method: "POST" });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).project.owner_id, "test-owner");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("test app rejects invalid command kinds with validation errors", async () => {
  const server = createServer(createTestApp());
  const origin = await listen(server);
  try {
    const created = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Test" })
    });
    const { project } = await created.json();
    const response = await fetch(`${origin}/api/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "invalid",
        base_revision: 0,
        client_timestamp: "",
        kind: "delete_scene",
        payload: {}
      })
    });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { type: "validation", message: "invalid command" });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("update_scene media_id must be owner-scoped and ready", async () => {
  const assets = new Map();
  const server = createServer(createTestApp({
    media: {
      repository: {
        async get(ownerId, projectId, id) {
          return assets.get(`${ownerId}:${projectId}:${id}`);
        }
      },
      store: {},
      pexels: {},
      async enqueueInspection() {}
    }
  }));
  const origin = await listen(server);
  try {
    const created = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "Media" })
    });
    const { project } = await created.json();
    const selected = await fetch(`${origin}/api/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "select",
        base_revision: 0,
        client_timestamp: "",
        kind: "select_concept",
        payload: { concept_id: "direct" }
      })
    });
    const afterSelect = await selected.json();
    const scene = afterSelect.scenes[0];
    const missing = await fetch(`${origin}/api/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "attach-missing",
        base_revision: afterSelect.revision,
        client_timestamp: "",
        kind: "update_scene",
        payload: { scene: { ...scene, media_id: "missing" } }
      })
    });
    assert.equal(missing.status, 422);

    assets.set(`authenticated-user:${project.id}:quarantined`, {
      id: "quarantined",
      ownerId: "authenticated-user",
      projectId: project.id,
      state: "quarantined"
    });
    const quarantined = await fetch(`${origin}/api/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "attach-quarantined",
        base_revision: afterSelect.revision,
        client_timestamp: "",
        kind: "update_scene",
        payload: { scene: { ...scene, media_id: "quarantined" } }
      })
    });
    assert.equal(quarantined.status, 422);

    assets.set(`authenticated-user:${project.id}:ready-asset`, {
      id: "ready-asset",
      ownerId: "authenticated-user",
      projectId: project.id,
      state: "ready"
    });
    const ready = await fetch(`${origin}/api/projects/${project.id}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "attach-ready",
        base_revision: afterSelect.revision,
        client_timestamp: "",
        kind: "update_scene",
        payload: { scene: { ...scene, media_id: "ready-asset" } }
      })
    });
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).scenes[0].media_id, "ready-asset");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
