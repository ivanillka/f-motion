import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { coalesce, listenSupported, startOutboxListener, workOutboxChannel } from "../dist/outbox-wake.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeClient extends EventEmitter {
  constructor(script) {
    super();
    this.script = script;
    this.queries = [];
    this.ended = false;
  }
  async connect() {
    if (this.script.connectFails) throw new Error("connect refused");
  }
  async query(sql) {
    this.queries.push(sql);
    if (sql === "SELECT 1" && this.script.heartbeatHangs) return new Promise(() => {});
    if (sql.startsWith("LISTEN") && this.script.listenFails) throw new Error("LISTEN not supported");
    return { rows: [] };
  }
  async end() {
    this.ended = true;
  }
}

function harness(scripts, options = {}) {
  const clients = [];
  const events = { notify: 0, ready: 0, errors: [] };
  const listener = startOutboxListener({
    connectionString: "postgresql://u@db.example:5432/postgres",
    onNotify: () => { events.notify += 1; },
    onReady: () => { events.ready += 1; },
    onError: (error) => { events.errors.push(error); },
    initialBackoffMs: 10,
    maxBackoffMs: 40,
    heartbeatMs: 1_000_000,
    ...options,
    createClient: () => {
      const client = new FakeClient(scripts[Math.min(clients.length, scripts.length - 1)]);
      clients.push(client);
      return client;
    }
  });
  return { listener, clients, events };
}

test("LISTEN only runs on a session that stays on one backend", () => {
  assert.equal(listenSupported("postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"), true);
  assert.equal(listenSupported("postgresql://fengine:fengine@postgres:5432/fengine"), true);
  assert.equal(listenSupported("postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"), false);
  assert.equal(listenSupported("postgresql://u:p@host:5432/db?pgbouncer=true"), false);
  assert.equal(listenSupported("postgresql://u:p@host:5432/db", { FENGINE_QUEUE_LISTEN: "0" }), false);
  assert.equal(listenSupported("not a url"), false);
});

test("a NOTIFY on the outbox channel wakes the dispatcher", async () => {
  const { listener, clients, events } = harness([{}]);
  await wait(5);
  assert.equal(listener.connected, true);
  assert.deepEqual(clients[0].queries, [`LISTEN "${workOutboxChannel}"`]);
  assert.equal(events.ready, 1, "catch-up pass on connect");
  clients[0].emit("notification", { channel: workOutboxChannel });
  clients[0].emit("notification", { channel: "someone_else" });
  assert.equal(events.notify, 1);
  await listener.close();
  assert.equal(clients[0].ended, true);
});

test("a dropped session reconnects with backoff and catches up", async () => {
  const { listener, clients, events } = harness([{}, { connectFails: true }, { connectFails: true }, {}]);
  await wait(5);
  assert.equal(events.ready, 1);
  clients[0].emit("error", new Error("terminating connection due to administrator command"));
  assert.equal(listener.connected, false);
  // backoff 10ms, then 20ms after a failed connect, then 40ms (cap)
  await wait(150);
  assert.equal(clients.length, 4);
  assert.equal(listener.connected, true);
  assert.equal(events.ready, 2, "catch-up pass after the reconnect");
  assert.equal(events.errors.length, 3);
  clients[3].emit("notification", { channel: workOutboxChannel });
  assert.equal(events.notify, 1);
  await listener.close();
});

test("a LISTEN that fails keeps retrying and never throws", async () => {
  const { listener, clients, events } = harness([{ listenFails: true }]);
  await wait(80);
  assert.equal(listener.connected, false);
  assert.ok(clients.length >= 3);
  assert.ok(events.errors.every((error) => /LISTEN not supported/.test(error.message)));
  assert.equal(events.ready, 0);
  await listener.close();
  const count = clients.length;
  await wait(80);
  assert.equal(clients.length, count, "no reconnect after close");
});

test("a silent dead socket is found by the heartbeat", async () => {
  const { listener, clients, events } = harness([{ heartbeatHangs: true }, {}], {
    heartbeatMs: 20,
    heartbeatTimeoutMs: 10
  });
  await wait(100);
  assert.ok(clients.length >= 2);
  assert.match(events.errors[0].message, /heartbeat timed out/);
  assert.equal(listener.connected, true);
  await listener.close();
});

test("bursts of wakes collapse into at most one extra pass", async () => {
  let passes = 0;
  let release;
  const run = coalesce(async () => {
    passes += 1;
    if (passes === 1) await new Promise((resolve) => { release = resolve; });
  });
  const first = run();
  run();
  run();
  run();
  release();
  await first;
  await wait(5);
  assert.equal(passes, 2);
  await run();
  assert.equal(passes, 3);
});
