import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ProjectService } from "../dist/domain.js";
import { createTestApp } from "../dist/server.js";
import {
  assertSelfhostConfig,
  engineEnv,
  MemorySelfhostOwner,
  ownerEmailMatches,
  selfhostOwnerResetRequested,
  SetupClosedError
} from "../dist/selfhost-auth.js";
import { UnauthorizedError } from "../dist/auth.js";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

test("engineEnv prefers FENGINE_ENV then FMOTION_ENV", () => {
  assert.equal(engineEnv({ FENGINE_ENV: "selfhost", FMOTION_ENV: "hosted" }), "selfhost");
  assert.equal(engineEnv({ FMOTION_ENV: "selfhost" }), "selfhost");
  assert.equal(engineEnv({}), undefined);
});

test("selfhost config forbids local auth and does not require a bootstrap token", () => {
  assert.throws(() => assertSelfhostConfig({}), /selfhost/);
  assert.throws(
    () => assertSelfhostConfig({ FENGINE_ENV: "selfhost", FENGINE_LOCAL_AUTH: "1" }),
    /FENGINE_LOCAL_AUTH/
  );
  assert.doesNotThrow(() => assertSelfhostConfig({ FENGINE_ENV: "selfhost" }));
  assert.doesNotThrow(() => assertSelfhostConfig({ FMOTION_ENV: "selfhost" }));
});

test("first owner setup issues a session and closes further sign-ups", async () => {
  const auth = new MemorySelfhostOwner([{ id: "selfhost-operator", state: "active" }]);
  assert.equal(await auth.setupNeeded(), true);
  const created = await auth.setup({
    email: " Owner@example.com ",
    password: "secret-pass",
    display_name: "Ada"
  });
  assert.equal(created.owner_id, "selfhost-operator");
  assert.equal(created.display_name, "Ada");
  assert.match(created.access_token, /^fms_/);
  assert.equal(await auth.setupNeeded(), false);
  await assert.rejects(
    auth.setup({ email: "other@example.com", password: "secret-pass" }),
    SetupClosedError
  );
  assert.equal(
    await auth.ownerIdForAuthorization(`Bearer ${created.access_token}`),
    "selfhost-operator"
  );
  const signedIn = await auth.login({ email: "OWNER@example.com", password: "secret-pass" });
  assert.equal(signedIn.owner_id, "selfhost-operator");
  await assert.rejects(
    auth.login({ email: "owner@example.com", password: "wrong-pass" }),
    (error) => error instanceof UnauthorizedError && error.message === "Email or password was rejected."
  );
});

test("owner email compare ignores case and surrounding space", () => {
  assert.equal(ownerEmailMatches("Owner@Example.COM", "owner@example.com"), true);
  assert.equal(ownerEmailMatches(" owner@example.com ", "owner@example.com"), true);
  assert.equal(ownerEmailMatches(undefined, "owner@example.com"), false);
  assert.equal(selfhostOwnerResetRequested({ FENGINE_SELFHOST_RESET_OWNER: "1" }), true);
  assert.equal(selfhostOwnerResetRequested({ FMOTION_SELFHOST_RESET_OWNER: "1" }), true);
  assert.equal(selfhostOwnerResetRequested({ FENGINE_SELFHOST_RESET_OWNER: "yes" }), false);
  assert.equal(selfhostOwnerResetRequested({}), false);
});

test("self-host HTTP setup then login; projects stay locked until then", async () => {
  const auth = new MemorySelfhostOwner();
  const server = createServer(createTestApp({
    ownerAuth: auth,
    projects: new ProjectService()
  }));
  const origin = await listen(server);
  try {
    assert.equal((await fetch(`${origin}/api/projects`)).status, 401);
    assert.deepEqual(await (await fetch(`${origin}/api/setup`)).json(), { needed: true });
    const created = await fetch(`${origin}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "secret-pass", display_name: "Ada" })
    });
    assert.equal(created.status, 201);
    const session = await created.json();
    const listed = await fetch(`${origin}/api/projects`, {
      headers: { authorization: `Bearer ${session.access_token}` }
    });
    assert.equal(listed.status, 200);
    const replay = await fetch(`${origin}/api/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "other@example.com", password: "secret-pass" })
    });
    assert.equal(replay.status, 409);
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer fms_stale"
      },
      body: JSON.stringify({ email: "owner@example.com", password: "secret-pass" })
    });
    assert.equal(login.status, 200);
    assert.match((await login.json()).access_token, /^fms_/);
    const rejected = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com", password: "wrong-pass" })
    });
    assert.equal(rejected.status, 401);
    assert.deepEqual(await rejected.json(), {
      type: "unauthorized",
      message: "Email or password was rejected."
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("owner password can be replaced when FENGINE_SELFHOST_RESET_OWNER=1", async () => {
  const previous = process.env.FENGINE_SELFHOST_RESET_OWNER;
  try {
    const auth = new MemorySelfhostOwner([{ id: "selfhost-operator", state: "active" }]);
    await auth.setup({ email: "owner@example.com", password: "secret-pass" });
    const first = await auth.login({ email: "owner@example.com", password: "secret-pass" });
    process.env.FENGINE_SELFHOST_RESET_OWNER = "1";
    assert.equal(await auth.setupNeeded(), true);
    const replaced = await auth.setup({ email: "Owner@example.com", password: "new-secret" });
    assert.equal(replaced.owner_id, "selfhost-operator");
    await assert.rejects(auth.ownerIdForAuthorization(`Bearer ${first.access_token}`), UnauthorizedError);
    const signedIn = await auth.login({ email: "owner@example.com", password: "new-secret" });
    assert.equal(signedIn.owner_id, "selfhost-operator");
  } finally {
    if (previous === undefined) delete process.env.FENGINE_SELFHOST_RESET_OWNER;
    else process.env.FENGINE_SELFHOST_RESET_OWNER = previous;
  }
});
