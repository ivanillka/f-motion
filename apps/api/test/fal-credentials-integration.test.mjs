import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { credentialVaultFromEnv } from "@f-engine/fal-host";
import { PostgresFalCredentialService } from "../dist/fal-credentials.js";
import { createTestApp } from "../dist/server.js";

const integration = process.env.RUN_FAL_INTEGRATION === "1" ? test : test.skip;

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function pricingFetch() {
  return async () => new Response(JSON.stringify({
    prices: [{
      endpoint_id: "fal-ai/flux/schnell",
      unit_price: 0.003,
      unit: "megapixel",
      currency: "USD"
    }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

integration("FAL credentials remain encrypted and isolated across real PostgreSQL owners", async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("FAL integration database configuration is required");
  const schema = `fal_test_${randomUUID().replaceAll("-", "_")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const ownerServer = createServer();
  const otherServer = createServer();
  try {
    const migrations = new URL("../../../prisma/migrations/", import.meta.url);
    for (const directory of (await readdir(migrations)).sort()) {
      await pool.query(await readFile(new URL(`${directory}/migration.sql`, migrations), "utf8"));
    }
    await pool.query(`INSERT INTO "User" (id, state) VALUES ('owner', 'active'), ('other', 'active')`);
    const vault = credentialVaultFromEnv({
      FENGINE_CREDENTIAL_ACTIVE_KEY_VERSION: "1",
      FENGINE_CREDENTIAL_KEY_V1: Buffer.alloc(32, 17).toString("base64")
    });
    const service = new PostgresFalCredentialService(pool, vault, pricingFetch());
    ownerServer.on("request", createTestApp({ ownerId: "owner", falCredentials: service }));
    otherServer.on("request", createTestApp({ ownerId: "other", falCredentials: service }));
    const ownerOrigin = await listen(ownerServer);
    const otherOrigin = await listen(otherServer);
    const synthetic = "synthetic-integration-key-1234";

    for (const origin of [ownerOrigin, otherOrigin]) {
      const response = await fetch(`${origin}/api/providers/fal/credential`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: synthetic })
      });
      assert.equal(response.status, 200);
      assert.equal((await response.text()).includes(synthetic), false);
    }

    const stored = (await pool.query(
      `SELECT "ownerId", ciphertext, nonce, "authTag", hint FROM "ProviderCredential" ORDER BY "ownerId"`
    )).rows;
    assert.equal(stored.length, 2);
    assert.equal(stored.every((row) => row.hint === "1234"), true);
    assert.equal(stored.every((row) => row.nonce.length === 12 && row.authTag.length === 16), true);
    assert.notDeepEqual(stored[0].ciphertext, stored[1].ciphertext);
    assert.equal(stored.some((row) => row.ciphertext.includes(Buffer.from(synthetic))), false);

    const ownerStatus = await (await fetch(`${ownerOrigin}/api/providers/fal/credential`)).json();
    const otherStatus = await (await fetch(`${otherOrigin}/api/providers/fal/credential`)).json();
    assert.deepEqual(ownerStatus.hint, "1234");
    assert.deepEqual(otherStatus.hint, "1234");

    assert.equal((await fetch(`${ownerOrigin}/api/providers/fal/credential`, { method: "DELETE" })).status, 204);
    assert.deepEqual(await (await fetch(`${ownerOrigin}/api/providers/fal/credential`)).json(), {
      provider: "fal",
      connected: false
    });
    assert.equal((await fetch(`${otherOrigin}/api/providers/fal/credential`)).status, 200);
    assert.equal(Number((await pool.query(
      `SELECT COUNT(*) AS count FROM "ProviderCredential" WHERE "ownerId" = 'other'`
    )).rows[0].count), 1);

    await pool.query(`DELETE FROM "User" WHERE id = 'other'`);
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS count FROM "ProviderCredential"`)).rows[0].count), 0);
  } finally {
    await close(ownerServer);
    await close(otherServer);
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
