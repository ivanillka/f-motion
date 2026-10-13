#!/usr/bin/env node
/**
 * Reel-path smoke — the as-built create-flow surface, local/test mode only.
 *
 * Four things a reviewer wants green together:
 *   1. skip-pool      POST /api/create-sessions { skipPool: true } → storyboard
 *   2. with-pool      pool items fill the session and attach uniquely
 *   3. sources strip  Pexels/FAL credential reads + chip and toggle state
 *   4. Animate stills Gate 0 blocks without FAL BYOK; the craft stamps it with
 *
 * Everything talks to a throwaway test-mode API bound by this process on
 * 127.0.0.1 (createTestApp plus stub credential services): no Postgres, no
 * Supabase, no production origin, and no FAL/Pexels traffic leaves the box.
 * The web side is the real client code (apps/web/src/create-flow-client.ts,
 * media-sources.ts, api.ts) loaded through Node's type stripping.
 *
 * Usage: npm run smoke:reel        (builds apps/api and its packages first)
 * Exit code 0 = every check passed, 1 = at least one failed.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createTestApp } from "../../apps/api/dist/server.js";
import { ApiClient, ApiResponseError } from "../../apps/web/src/api.ts";
import { generateReelSession, mediaPrefFromPlan } from "../../apps/web/src/create-flow-client.ts";
import {
  animateStillsToggleState,
  countStillFiles,
  isReadyStillMedia,
  mediaSourceChips,
  sourceChipTone
} from "../../apps/web/src/media-sources.ts";

const OWNER = "reel-path-smoke";

/** Stub BYOK services: the smoke flips `connected` instead of calling providers. */
function credentialStub(provider) {
  return {
    connected: false,
    async status() {
      return this.connected
        ? { provider, connected: true, hint: "4242", validated_at: "2026-01-01T00:00:00.000Z" }
        : { provider, connected: false };
    },
    async connect() {
      this.connected = true;
      return this.status();
    },
    async test() {
      return this.status();
    },
    async disconnect() {
      this.connected = false;
    },
    async decryptForOwner() {
      return { id: `${provider}-smoke`, apiKey: `${provider}-stub-key` };
    }
  };
}

const fal = credentialStub("fal");
const pexels = credentialStub("pexels");
const server = createServer(createTestApp({
  ownerId: OWNER,
  falCredentials: fal,
  pexelsCredentials: pexels
}));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("smoke API did not bind");
const origin = `http://127.0.0.1:${address.port}`;

// ApiClient.request fetches relative paths; scope them to this throwaway origin
// and record every status so the run can prove nothing answered 5xx.
const fetchImpl = globalThis.fetch;
const statuses = [];
globalThis.fetch = async (input, init) => {
  const scoped = typeof input === "string" && input.startsWith("/") ? `${origin}${input}` : input;
  const response = await fetchImpl(scoped, init);
  statuses.push(response.status);
  return response;
};
const api = new ApiClient(() => "smoke-token");

const POOL = [
  { id: "still-harbor", kind: "image", score: 0.96 },
  { id: "clip-dock", kind: "video", score: 0.9 },
  { id: "still-awning", kind: "image", score: 0.84 }
];

const checks = [];

async function check(name, run) {
  try {
    const detail = await run();
    checks.push({ name, ok: true, detail: typeof detail === "string" ? detail : undefined });
  } catch (error) {
    checks.push({ name, ok: false, error: describe(error) });
  }
}

function describe(error) {
  if (error instanceof ApiResponseError) {
    const type = error.type ? ` type=${error.type}` : "";
    const message = typeof error.body.message === "string" ? ` message=${JSON.stringify(error.body.message)}` : "";
    return `HTTP ${error.status}${type}${message}`;
  }
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function reelArtifact(session) {
  const artifact = session.artifacts.find((item) => item.typeId === "reel_vertical");
  assert.ok(artifact, "reel_vertical artifact is missing from the session");
  assert.ok(
    artifact.craftPayload,
    `artifact has no craft payload (status=${artifact.status}, error=${artifact.error ?? "none"})`
  );
  return artifact;
}

try {
  await check("catalog: reel_vertical is the only polish-ready type", async () => {
    const { types } = await api.request("/api/content-types");
    assert.deepEqual(types.map((item) => item.typeId), ["reel_vertical"]);
    return `${types.length} type`;
  });

  await check("skip-pool: an empty pool with the own pref answers 400, not 500", async () => {
    await assert.rejects(
      generateReelSession(api, {
        purpose: "Harbor night market for visitors",
        skipPool: true,
        mediaSourcePref: "own",
        durationSeconds: 15
      }),
      (error) => {
        assert.ok(error instanceof ApiResponseError, `expected an API error, got ${error?.name ?? error}`);
        assert.equal(error.status, 400);
        assert.equal(error.type, "validation");
        assert.match(String(error.body.message), /own media required/i);
        return true;
      }
    );
    return "400 validation";
  });

  await check("skip-pool: the strip's honest pref (defer) generates without media", async () => {
    const pref = mediaPrefFromPlan({ media: "own" }, { hasOwn: false, pexelsConnected: false });
    assert.equal(pref, "defer", "honest pref for an empty own pool");
    const { session, craft } = await generateReelSession(api, {
      purpose: "Harbor night market for visitors",
      skipPool: true,
      mediaSourcePref: pref,
      durationSeconds: 15
    });
    assert.equal(session.poolMode, "skipped");
    assert.equal(session.status, "done");
    assert.equal(reelArtifact(session).status, "ready");
    assert.equal(craft.kind, "reel_storyboard");
    assert.ok(craft.scenes.length >= 1, "storyboard needs at least one scene");
    assert.deepEqual(craft.mediaAttach.filter((item) => item.mediaId), [], "skip-pool attaches no media");
    return `${craft.scenes.length} scenes, no media`;
  });

  await check("with-pool: pool items fill the session and attach uniquely", async () => {
    const { session, craft } = await generateReelSession(api, {
      purpose: "Cafe morning for locals",
      skipPool: false,
      poolItems: POOL,
      mediaSourcePref: "own",
      durationSeconds: 15
    });
    assert.equal(session.poolMode, "filled");
    assert.equal(session.status, "done");
    const attached = craft.mediaAttach.filter((item) => item.mediaId).map((item) => item.mediaId);
    assert.ok(attached.length >= 1, "pool media must attach");
    assert.equal(new Set(attached).size, attached.length, "attach must never reuse a media id");
    const posted = new Set(POOL.map((item) => item.id));
    assert.ok(attached.every((id) => posted.has(id)), `attached ids must come from the pool: ${attached.join(", ")}`);
    assert.ok(craft.scenes.some((scene) => scene.media_id), "attached scenes carry media_id");
    return `${attached.length} of ${POOL.length} pool items attached`;
  });

  await check("sources strip: credential reads drive the chip states", async () => {
    fal.connected = false;
    pexels.connected = false;
    const locked = mediaSourceChips({
      ownCount: 0,
      pexelsConnected: (await api.request("/api/providers/pexels/credential")).connected,
      falConnected: (await api.request("/api/providers/fal/credential")).connected
    });
    assert.deepEqual(locked.map((chip) => `${chip.id}:${chip.state}`), [
      "own:locked", "pexels:locked", "fal:locked", "more:coming"
    ]);
    assert.equal(sourceChipTone(locked[2].state), "muted");

    fal.connected = true;
    pexels.connected = true;
    const live = mediaSourceChips({
      ownCount: 3,
      pexelsConnected: (await api.request("/api/providers/pexels/credential")).connected,
      falConnected: (await api.request("/api/providers/fal/credential")).connected
    });
    assert.equal(live.find((chip) => chip.id === "own").state, "ready");
    assert.match(live.find((chip) => chip.id === "own").detail, /3/);
    assert.equal(live.find((chip) => chip.id === "fal").state, "connected");
    assert.equal(sourceChipTone("connected"), "on");
    fal.connected = false;
    pexels.connected = false;
    return "locked -> connected";
  });

  await check("sources strip: markup keeps chips, the toggle, and stays in-app", async () => {
    const source = await readFile(new URL("../../apps/web/src/main.tsx", import.meta.url), "utf8");
    assert.match(source, /className="media-sources-strip" aria-label="Media sources"/);
    assert.match(source, /const sourcesStrip = inApp \?/);
    assert.match(source, /\{sourceChips\.map\(\(chip\) => \(/);
    assert.match(source, /data-state=\{chip\.state\}/);
    assert.match(source, /className=\{`media-source-chip tone-\$\{sourceChipTone\(chip\.state\)\}`\}/);
    assert.match(source, /className=\{`animate-stills-toggle\$\{animateToggle\.enabled \? "" : " is-disabled"\}`\}/);
    assert.match(source, /title=\{animateToggle\.reason\}/);
    assert.match(source, /disabled=\{!animateToggle\.enabled \|\| busy\}/);
    assert.match(source, /\{sourcesStrip\}/);
    return "main.tsx";
  });

  await check("sources strip: pref mapping never claims a key the owner has not connected", async () => {
    const cases = [
      [{ media: "own" }, { hasOwn: false, pexelsConnected: false }, "defer"],
      [{ media: "own" }, { hasOwn: true, pexelsConnected: false }, "own"],
      [{ media: "stock" }, { hasOwn: false, pexelsConnected: false }, "defer"],
      [{ media: "stock" }, { hasOwn: false, pexelsConnected: true }, "pexels"],
      [{ media: "stock" }, { hasOwn: true, pexelsConnected: false }, "own"],
      [{ media: "mixed" }, { hasOwn: true, pexelsConnected: true }, "mix"],
      [{ media: "mixed" }, { hasOwn: false, pexelsConnected: true }, "pexels"],
      [{ media: "mixed" }, { hasOwn: true, pexelsConnected: false }, "own"],
      [{ media: "mixed" }, { hasOwn: false, pexelsConnected: false }, "defer"]
    ];
    for (const [plan, keys, expected] of cases) {
      assert.equal(mediaPrefFromPlan(plan, keys), expected, `${plan.media} with ${JSON.stringify(keys)}`);
    }
    return `${cases.length} cases`;
  });

  await check("animate stills: FAL disconnected answers 403 gate0, never a 500", async () => {
    fal.connected = false;
    await assert.rejects(
      generateReelSession(api, {
        purpose: "Animate a quiet harbor still",
        skipPool: false,
        poolItems: POOL,
        mediaSourcePref: "own",
        durationSeconds: 15,
        animateStills: true
      }),
      (error) => {
        assert.ok(error instanceof ApiResponseError, `expected an API error, got ${error?.name ?? error}`);
        assert.equal(error.status, 403);
        assert.equal(error.type, "gate0");
        assert.match(String(error.body.message), /FAL/i);
        return true;
      }
    );
    return "403 gate0";
  });

  await check("animate stills: FAL connected accepts the setting and stamps the craft", async () => {
    fal.connected = true;
    const { session, craft } = await generateReelSession(api, {
      purpose: "Animate a quiet harbor still",
      skipPool: false,
      poolItems: POOL,
      mediaSourcePref: "own",
      durationSeconds: 15,
      animateStills: true
    });
    assert.equal(session.status, "done");
    assert.equal(craft.animateStills, true, "craft payload must carry the Animate stills intent");
    assert.equal(
      session.typeSettings?.reel_vertical?.animateStills,
      true,
      "session settings keep the Animate stills intent"
    );
    assert.ok(craft.scenes.some((scene) => scene.media_id), "stills must be attached before animating");
    fal.connected = false;
    return "craft.animateStills + settings";
  });

  await check("animate stills: the strip toggle stays honest about why it is off", async () => {
    assert.deepEqual(
      animateStillsToggleState({ falConnected: false, falUnavailable: false, stillCount: 2 }),
      { enabled: false, reason: "Connect FAL (BYOK)" }
    );
    assert.deepEqual(
      animateStillsToggleState({ falConnected: true, falUnavailable: true, stillCount: 2 }),
      { enabled: false, reason: "FAL unavailable here" }
    );
    const noStills = animateStillsToggleState({ falConnected: true, falUnavailable: false, stillCount: 0 });
    assert.equal(noStills.enabled, false);
    assert.match(noStills.reason, /stills/i);
    const ready = animateStillsToggleState({ falConnected: true, falUnavailable: false, stillCount: 1 });
    assert.equal(ready.enabled, true);
    assert.match(ready.reason, /confirm/i);
    assert.equal(countStillFiles([{ type: "image/jpeg" }, { type: "video/mp4" }, { type: "image/png" }]), 2);
    assert.equal(isReadyStillMedia({ state: "ready", detected: { type: "image/jpeg" } }), true);
    assert.equal(isReadyStillMedia({ state: "ready", detected: { type: "video/mp4" } }), false);
    assert.equal(isReadyStillMedia({ state: "inspecting", detected: { type: "image/jpeg" } }), false);
    return "4 toggle reasons";
  });

  await check("whole reel path: no response answered 5xx", async () => {
    const fiveHundred = statuses.filter((status) => status >= 500);
    assert.deepEqual(fiveHundred, [], `5xx seen: ${fiveHundred.join(", ")}`);
    return `${statuses.length} responses`;
  });
} finally {
  globalThis.fetch = fetchImpl;
  await new Promise((resolve) => server.close(resolve));
}

const failed = checks.filter((item) => !item.ok);
console.log(`reel-path smoke · ${checks.length - failed.length}/${checks.length} checks passed`);
for (const item of checks) {
  console.log(`  ${item.ok ? "PASS" : "FAIL"}  ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  if (!item.ok) console.log(`        ${item.error}`);
}
if (failed.length) {
  console.log(`\n${failed.length} check(s) FAILED`);
  process.exitCode = 1;
} else {
  console.log("\nreel path is green (local/test mode, no provider calls)");
}
