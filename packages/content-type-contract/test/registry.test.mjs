import test from "node:test";
import assert from "node:assert/strict";
import { TypeRegistry, TypeRegistryError } from "../dist/index.js";

function stubModule(typeId, phase = "polish_ready") {
  return {
    typeId,
    kind: "video",
    label: typeId,
    phase,
    settingsSchema: { type: "object" },
    mediaPolicy: { requirement: "required", preferredSources: ["own"] },
    editorModel: "storyboard",
    validateSettings() { return { ok: true }; },
    planMedia(_session, catalog) { return catalog; },
    async generate() { return { craftPayload: { ok: true } }; },
    preview() { return { surface: "storyboard", aspect: "9:16" }; },
    qa() { return "ready"; },
    exportPackage() { return { format: "mp4" }; }
  };
}

test("registry registers and lists polish-ready modules only when asked", () => {
  const registry = new TypeRegistry();
  registry.register(stubModule("reel_vertical"));
  assert.equal(registry.listPolishReady().length, 1);
  assert.equal(registry.listPolishReady()[0].typeId, "reel_vertical");
  assert.equal(registry.require("reel_vertical").editorModel, "storyboard");
});

test("registry rejects duplicate typeId and selected skips unknown", () => {
  const registry = new TypeRegistry();
  registry.register(stubModule("reel_vertical"));
  assert.throws(() => registry.register(stubModule("reel_vertical")), TypeRegistryError);
  assert.deepEqual(
    registry.selected(["reel_vertical", "carousel_stills"]).map((m) => m.typeId),
    ["reel_vertical"]
  );
});

test("coming modules are listed but not selected for craft", () => {
  const registry = new TypeRegistry();
  registry.register(stubModule("reel_vertical"));
  registry.register(stubModule("future_type", "coming"));
  assert.equal(registry.list().length, 2);
  assert.equal(registry.selected(["future_type"]).length, 0);
  assert.equal(registry.selected(["reel_vertical", "future_type"]).length, 1);
});
