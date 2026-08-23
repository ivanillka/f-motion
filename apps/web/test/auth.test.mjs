import test from "node:test";
import assert from "node:assert/strict";
import { AuthConfigurationError, authCallbackError, createAuthGateway, studioOrigin } from "../src/auth.ts";

test("hosted magic links return to the F-Motion studio", () => {
  assert.equal(studioOrigin("https://f-motion.com/app/?project=59af46af-b82d-5fda-a837-652b88dcb50f"), "https://f-motion.com/studio");
  assert.equal(studioOrigin("https://f-motion.com/"), "https://f-motion.com/studio");
  assert.equal(studioOrigin("https://www.f-motion.com/app/"), "https://f-motion.com/studio");
  assert.equal(studioOrigin("https://8b24f3e9.f-motion.pages.dev/app/"), "https://f-motion.com/studio");
  assert.equal(studioOrigin("http://localhost:5173/"), "http://localhost:5173/studio");
});

test("authCallbackError reads expired OTP from query or hash", () => {
  assert.equal(
    authCallbackError("https://f-motion.com/app/?error_code=otp_expired#error_code=otp_expired&sb="),
    "otp_expired"
  );
  assert.equal(authCallbackError("https://f-motion.com/app/#error_code=otp_expired"), "otp_expired");
  assert.equal(authCallbackError("https://f-motion.com/app/?project=59af46af-b82d-5fda-a837-652b88dcb50f"), undefined);
});

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    entries: () => [...values.entries()]
  };
}

function fakeSupabase() {
  const calls = [];
  let authListener = () => undefined;
  let unsubscribed = false;
  const client = {
    auth: {
      onAuthStateChange(listener) {
        authListener = listener;
        return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
      },
      async signInWithOtp(input) {
        calls.push(["otp", input]);
        return { error: null };
      },
      async signInWithOAuth(input) {
        calls.push(["oauth", input]);
        return { error: null };
      },
      async signOut() {
        calls.push(["signout"]);
        return { error: null };
      }
    }
  };
  return {
    client,
    calls,
    emit: (event, session) => authListener(event, session),
    wasUnsubscribed: () => unsubscribed
  };
}

test("hosted authentication requires both public settings", () => {
  for (const config of [
    { url: "https://example.supabase.co", publicKey: undefined },
    { url: undefined, publicKey: "public-key" },
    { url: undefined, publicKey: undefined }
  ]) {
    assert.throws(
      () => createAuthGateway({ ...config, origin: "https://app.example", allowDemo: false }),
      AuthConfigurationError
    );
  }
});

test("Supabase client uses PKCE and refreshable persistent sessions", () => {
  const fake = fakeSupabase();
  let created;
  createAuthGateway(
    {
      url: " https://example.supabase.co ",
      publicKey: " public-key ",
      origin: "https://app.example/",
      allowDemo: false
    },
    {
      createClient(url, publicKey, options) {
        created = { url, publicKey, options };
        return fake.client;
      }
    }
  );
  assert.deepEqual(created, {
    url: "https://example.supabase.co",
    publicKey: "public-key",
    options: {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      }
    }
  });
});

test("session lifecycle forwards only live access tokens and unsubscribes", () => {
  const fake = fakeSupabase();
  const gateway = createAuthGateway(
    {
      url: "https://example.supabase.co",
      publicKey: "public-key",
      origin: "https://app.example",
      allowDemo: false
    },
    { createClient: () => fake.client }
  );
  const sessions = [];
  const unsubscribe = gateway.subscribe((session) => sessions.push(session?.accessToken));
  fake.emit("INITIAL_SESSION", { access_token: "first" });
  fake.emit("TOKEN_REFRESHED", { access_token: "second" });
  fake.emit("PASSWORD_RECOVERY", { access_token: "ignored" });
  fake.emit("SIGNED_OUT", null);
  unsubscribe();
  assert.deepEqual(sessions, ["first", "second", undefined]);
  assert.equal(fake.wasUnsubscribed(), true);
});

test("magic-link, Google, and sign-out use the official auth client", async () => {
  const fake = fakeSupabase();
  const gateway = createAuthGateway(
    {
      url: "https://example.supabase.co",
      publicKey: "public-key",
      origin: "https://app.example/path/",
      allowDemo: false
    },
    { createClient: () => fake.client }
  );
  await gateway.sendMagicLink(" person@example.com ");
  await gateway.signInWithGoogle();
  await gateway.signOut();
  assert.deepEqual(fake.calls, [
    ["otp", {
      email: "person@example.com",
      options: { emailRedirectTo: "https://app.example/path/" }
    }],
    ["oauth", {
      provider: "google",
      options: { redirectTo: "https://app.example/path/" }
    }],
    ["signout"]
  ]);
});

test("auth client errors are propagated", async () => {
  const fake = fakeSupabase();
  fake.client.auth.signInWithOtp = async () => ({ error: new Error("rejected") });
  const gateway = createAuthGateway(
    {
      url: "https://example.supabase.co",
      publicKey: "public-key",
      origin: "https://app.example",
      allowDemo: false
    },
    { createClient: () => fake.client }
  );
  await assert.rejects(gateway.sendMagicLink("person@example.com"), /rejected/);
});

function fakeSelfhostApi() {
  const owners = [];
  return async (url, init = {}) => {
    const method = init.method ?? "GET";
    if (url === "/api/setup" && method === "GET") {
      return { ok: true, status: 200, json: async () => ({ needed: owners.length === 0 }) };
    }
    if ((url === "/api/setup" && method === "POST") || (url === "/api/auth/login" && method === "POST")) {
      const body = JSON.parse(init.body);
      if (url === "/api/setup") {
        if (owners.length) return { ok: false, status: 409, json: async () => ({ message: "This install already has an owner." }) };
        owners.push(body.email);
      } else if (!owners.includes(body.email)) {
        return { ok: false, status: 401, json: async () => ({ message: "authentication required" }) };
      }
      return { ok: true, status: url === "/api/setup" ? 201 : 200, json: async () => ({ access_token: "fms_session" }) };
    }
    if (url === "/api/auth/logout") return { ok: true, status: 204, json: async () => ({}) };
    throw new Error(`unexpected ${method} ${url}`);
  };
}

test("self-host auth wins even when dummy Supabase settings are present", async () => {
  const storage = memoryStorage();
  let created = false;
  const gateway = createAuthGateway(
    {
      url: "https://example.supabase.co",
      publicKey: "public-key",
      origin: "http://127.0.0.1:8080/",
      allowDemo: false,
      allowSelfhost: true
    },
    {
      demoStorage: storage,
      fetchImpl: fakeSelfhostApi(),
      createClient() {
        created = true;
        throw new Error("must not construct Supabase");
      }
    }
  );
  assert.equal(typeof gateway.setupAccount, "function");
  assert.equal(typeof gateway.signInWithPassword, "function");
  await assert.rejects(gateway.sendMagicLink("person@example.com"), /email and password/);
  await assert.rejects(gateway.signInWithGoogle(), /email and password/);
  assert.equal(created, false);
  assert.equal(await gateway.setupNeeded(), true);
  await gateway.setupAccount("owner@example.com", "secret-pass", "Ada");
  assert.equal(storage.getItem("fengine-selfhost-token"), "fms_session");
});

test("self-host owner password stays in session storage and is the bearer", async () => {
  const storage = memoryStorage();
  const fetchImpl = fakeSelfhostApi();
  const gateway = createAuthGateway(
    { origin: "http://127.0.0.1:8080/", allowDemo: false, allowSelfhost: true },
    { demoStorage: storage, fetchImpl }
  );
  const sessions = [];
  const unsubscribe = gateway.subscribe((session) => sessions.push(session?.accessToken));
  await new Promise(queueMicrotask);
  assert.equal(sessions[0], undefined);
  await gateway.setupAccount("owner@example.com", "secret-pass", "Ada");
  assert.equal(sessions.at(-1), "fms_session");
  assert.equal(storage.getItem("fengine-selfhost-token"), "fms_session");
  await gateway.signOut();
  assert.equal(storage.getItem("fengine-selfhost-token"), null);
  assert.equal(sessions.at(-1), undefined);
  unsubscribe();
});

test("demo sessions store only a marker and clear it on sign-out", async () => {
  const storage = memoryStorage();
  const gateway = createAuthGateway(
    { origin: "http://localhost:5173", allowDemo: true },
    { demoStorage: storage }
  );
  const sessions = [];
  const unsubscribe = gateway.subscribe((session) => sessions.push(session?.accessToken));
  await new Promise(queueMicrotask);
  await gateway.sendMagicLink("");
  const issued = sessions.at(-1);
  assert.match(issued, /^local-demo-/);
  assert.equal(storage.getItem("fengine-demo-session"), "1");
  assert.equal(storage.getItem("fengine-access-token"), null);
  await gateway.signOut();
  assert.equal(storage.getItem("fengine-demo-session"), null);
  assert.equal(sessions.at(-1), undefined);
  unsubscribe();
});

test("demo session survives reload without persisting its bearer token", async () => {
  const storage = memoryStorage({ "fengine-demo-session": "1" });
  const gateway = createAuthGateway(
    { origin: "http://localhost:5173", allowDemo: true },
    { demoStorage: storage }
  );
  const sessions = [];
  gateway.subscribe((session) => sessions.push(session?.accessToken));
  await new Promise(queueMicrotask);
  assert.match(sessions[0], /^local-demo-/);
  assert.deepEqual(storage.entries(), [["fengine-demo-session", "1"]]);
  assert.equal(storage.entries().some(([, value]) => value === sessions[0]), false);
});
