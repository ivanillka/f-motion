import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("Postgres ADD VALUE migrations do not use the new enum in the same file", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  for (const name of readdirSync(dir)) {
    let sql;
    try {
      sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    for (const value of [...sql.matchAll(/ADD VALUE\s+'([^']+)'/gi)].map((match) => match[1])) {
      const rest = sql.replace(new RegExp(`ADD VALUE\\s+'${value}'`, "gi"), "");
      assert.equal(
        rest.includes(`'${value}'`),
        false,
        `${name} uses new enum '${value}' before Postgres can commit it`,
      );
    }
  }
});
