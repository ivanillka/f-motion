import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// F-Motion uses direct Postgres only. Tables must never be exposed to the
// Supabase Data API, so no migration grants to anon or authenticated, and every
// table created after the lockdown enables row level security in the same file.
const LOCKDOWN = "20261020190000_data_api_lockdown";
const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function migrations() {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      try {
        return [{ name, sql: readFileSync(join(dir, name, "migration.sql"), "utf8") }];
      } catch {
        return [];
      }
    });
}

test("no migration grants anything to anon or authenticated", () => {
  for (const { name, sql } of migrations()) {
    assert.equal(
      /\bGRANT\b[^;]*\bTO\s+[^;]*\b(anon|authenticated)\b/i.test(sql),
      false,
      `${name} grants to anon or authenticated; F-Motion never uses the Data API`,
    );
  }
});

test("tables created after the lockdown enable row level security", () => {
  const all = migrations();
  assert.ok(all.some(({ name }) => name === LOCKDOWN), `${LOCKDOWN} is missing`);
  for (const { name, sql } of all.filter(({ name }) => name > LOCKDOWN)) {
    for (const [, table] of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)) {
      const rls = new RegExp(`ALTER TABLE\\s+(?:"?public"?\\.)?"?${table}"?\\s+ENABLE ROW LEVEL SECURITY`, "i");
      assert.ok(rls.test(sql), `${name} creates "${table}" without ENABLE ROW LEVEL SECURITY`);
    }
  }
});
