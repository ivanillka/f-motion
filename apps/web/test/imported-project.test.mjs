import test from "node:test";
import assert from "node:assert/strict";
import {
  clearImportedProject,
  isImportedProjectId,
  rememberImportedProject
} from "../src/imported-project.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("imported project ids must look like UUIDs", () => {
  assert.equal(isImportedProjectId("59af46af-b82d-5fda-a837-652b88dcb50f"), true);
  assert.equal(isImportedProjectId("not-a-project"), false);
});

test("rememberImportedProject keeps ?project= across a redirect that drops the query", () => {
  const storage = memoryStorage();
  assert.equal(
    rememberImportedProject("https://f-motion.com/app/?project=59af46af-b82d-5fda-a837-652b88dcb50f", storage),
    "59af46af-b82d-5fda-a837-652b88dcb50f"
  );
  assert.equal(
    rememberImportedProject("https://f-motion.com/app/", storage),
    "59af46af-b82d-5fda-a837-652b88dcb50f"
  );
  clearImportedProject(storage);
  assert.equal(rememberImportedProject("https://f-motion.com/app/", storage), "");
});
