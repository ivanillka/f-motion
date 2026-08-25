import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { FAL_LLM_DEFAULT_MODEL, FAL_LLM_ENDPOINT_ID } from "@f-engine/fal-host";
import { FalCredentialMissingError } from "../dist/fal-credentials.js";
import {
  FalConversationService,
  parseConversationPlan
} from "../dist/fal-conversation.js";
import { createTestApp } from "../dist/server.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

const sampleArchitecture = {
  goal: "story",
  audience: "general",
  structure: "mystery",
  tone: "cinematic",
  pace: "slow",
  durationSeconds: 30,
  media: "stock"
};

const samplePlan = {
  architecture: sampleArchitecture,
  source: {
    caption: "Fog hides the island. A light still turns. No one answers.",
    visualHint: "lonely island lighthouse fog"
  },
  concept_overlays: {
    direct: { hook: "Lead with the unanswered light.", treatment: "Show the result, then the empty island." },
    story: { hook: "Establish the island, then turn.", treatment: "Wide fog, one human detail, one reveal." }
  }
};

test("conversation parse accepts fenced JSON and ignores a fourth concept", () => {
  const parsed = parseConversationPlan(`\`\`\`json
${JSON.stringify({
    architecture: { ...sampleArchitecture, duration_sec: 30 },
    source: { caption: "  Speakable copy.  ", visual_hint: "  fog island  " },
    concept_overlays: {
      direct: { hook: "Hook", treatment: "Treat" },
      extra: { hook: "Invented fourth concept" }
    }
  })}
\`\`\``, "fallback brief");
  assert.deepEqual(parsed.architecture, sampleArchitecture);
  assert.equal(parsed.source.caption, "Speakable copy.");
  assert.equal(parsed.source.visualHint, "fog island");
  assert.equal(parsed.concept_overlays?.direct?.hook, "Hook");
  assert.equal(parsed.concept_overlays?.extra, undefined);
});

test("conversation parse rejects unknown architecture enums without leaking output", () => {
  assert.throws(
    () => parseConversationPlan(JSON.stringify({
      architecture: { ...sampleArchitecture, goal: "epic" },
      source: { caption: "Copy" }
    }), "brief"),
    (error) => error.name === "FalConversationParseError" && !String(error).includes("epic")
  );
});

test("POST /api/providers/fal/conversation returns a mocked FAL plan", async () => {
  const server = createServer(createTestApp({
    falConversation: { plan: async () => samplePlan }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/providers/fal/conversation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "Mystery of a lonely island" })
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), samplePlan);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("POST /api/providers/fal/conversation maps a missing FAL key to 409", async () => {
  const server = createServer(createTestApp({
    falConversation: {
      plan: async () => {
        throw new FalCredentialMissingError("FAL is not connected");
      }
    }
  }));
  const origin = await listen(server);
  try {
    const response = await fetch(`${origin}/api/providers/fal/conversation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "A lighthouse in fog" })
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).type, "fal_not_connected");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("FalConversationService decrypts the owner key and posts to any-llm", async () => {
  let seen;
  const service = new FalConversationService({
    status: async () => ({ provider: "fal", connected: true }),
    connect: async () => ({ provider: "fal", connected: true }),
    test: async () => ({ provider: "fal", connected: true }),
    disconnect: async () => undefined,
    decryptForOwner: async (ownerId) => {
      assert.equal(ownerId, "owner");
      return { id: "cred", apiKey: "synthetic:key" };
    }
  }, async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({
      output: JSON.stringify({
        architecture: sampleArchitecture,
        source: { caption: "The light still turns.", visual_hint: "lighthouse fog" }
      })
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const plan = await service.plan("owner", "  A lonely lighthouse  ");
  assert.equal(seen.url, `https://fal.run/${FAL_LLM_ENDPOINT_ID}`);
  assert.match(seen.init.headers.authorization, /^Key synthetic:key$/);
  const body = JSON.parse(seen.init.body);
  assert.equal(body.prompt, "A lonely lighthouse");
  assert.equal(body.model, FAL_LLM_DEFAULT_MODEL);
  assert.match(body.system_prompt, /direct, story, and rhythm/);
  assert.match(body.system_prompt, /spoken script/);
  assert.equal(plan.source.caption, "The light still turns.");
  assert.equal(plan.architecture.structure, "mystery");
});
