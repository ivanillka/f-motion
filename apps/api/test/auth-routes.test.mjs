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

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const jwksServer = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  const jwksOrigin = await listen(jwksServer);
  const states = new Map([["active-owner", "active"], ["suspended-owner", "suspended"]]);
  const app = createApp({
    projects: new ProjectService(),
    authConfig: {
      issuer: "https://issuer.example",
      audience: "f-motion",
      jwksUrl: new URL("/jwks", jwksOrigin)
    },
    accountState: async (ownerId) => states.get(ownerId)
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
