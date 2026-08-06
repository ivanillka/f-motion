import test from "node:test";
import assert from "node:assert/strict";
import { AuthConfigurationError, createAuthGateway, parseMagicLink } from "../src/auth.ts";

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
      async verifyOtp(input) {
        calls.push(["verify", input]);
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

test("parseMagicLink reads token_hash from Supabase verify URLs", () => {
  assert.deepEqual(
    parseMagicLink("https://example.supabase.co/auth/v1/verify?token=abc123&type=magiclink&redirect_to=https://fotium.vip"),
    { token_hash: "abc123", type: "magiclink" }
  );
  assert.deepEqual(parseMagicLink("raw-token_hash.VALUE"), { token_hash: "raw-token_hash.VALUE", type: "magiclink" });
  assert.throws(() => parseMagicLink("https://example.supabase.co/auth/v1/verify"), /missing a token/);
});

test("email OTP and pasted magic links verify through Supabase", async () => {
  const fake = fakeSupabase();
  const gateway = createAuthGateway(
    {
      url: "https://example.supabase.co",
      publicKey: "public-key",
      origin: "https://f-motion.com",
      allowDemo: false
    },
    { createClient: () => fake.client }
  );
  await gateway.verifyEmailOtp("person@example.com", "123456");
  await gateway.completeMagicLink(
    "https://example.supabase.co/auth/v1/verify?token=deadbeef&type=magiclink&redirect_to=https://fotium.vip/"
  );
  assert.deepEqual(fake.calls, [
    ["verify", { email: "person@example.com", token: "123456", type: "email" }],
    ["verify", { token_hash: "deadbeef", type: "magiclink" }]
  ]);
});

test("pasted magic link falls back to email type when magiclink verify fails", async () => {
  const fake = fakeSupabase();
  fake.client.auth.verifyOtp = async (input) => {
    fake.calls.push(["verify", input]);
    if (input.type === "magiclink") return { error: new Error("Email link is invalid or has expired") };
    return { error: null };
  };
  const gateway = createAuthGateway(
    {
      url: "https://example.supabase.co",
      publicKey: "public-key",
      origin: "https://f-motion.com",
      allowDemo: false
    },
    { createClient: () => fake.client }
  );
  await gateway.completeMagicLink(
    "https://example.supabase.co/auth/v1/verify?token=deadbeef&type=magiclink"
  );
  assert.deepEqual(fake.calls, [
    ["verify", { token_hash: "deadbeef", type: "magiclink" }],
    ["verify", { token_hash: "deadbeef", type: "email" }]
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
