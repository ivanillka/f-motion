import test from "node:test";
import assert from "node:assert/strict";
import { TypeRegistry } from "@f-engine/content-type-contract";
import {
  CraftDispatcher,
  Gate0Error,
  Gate0Policy,
  createSession,
  patchSettings,
  poolSeam,
  questionSeam,
  settingsSeam,
  withPoolItems
} from "../dist/index.js";

function stubModule(typeId, { fail = false, mediaRequired = true } = {}) {
  return {
    typeId,
    kind: "video",
    label: typeId,
    phase: "polish_ready",
    settingsSchema: { type: "object", properties: { durationSeconds: { type: "number" } } },
    mediaPolicy: {
      requirement: mediaRequired ? "required" : "optional",
      preferredSources: ["own", "pexels"]
    },
    editorModel: "storyboard",
    validateSettings(_session, settings) {
      if (settings && typeof settings === "object" && "bad" in settings) {
        return { ok: false, error: "bad settings" };
      }
      return { ok: true };
    },
    planMedia(_session, catalog) {
      return catalog;
    },
    async generate(ctx) {
      if (fail) throw new Error("boom");
      return { craftPayload: { typeId, purpose: ctx.session.brief.purpose ?? "" }, previewRef: `preview:${typeId}` };
    },
    preview() {
      return { surface: "storyboard", aspect: "9:16" };
    },
    qa(artifact) {
      return artifact.craftPayload ? "ready" : "below_bar";
    },
    exportPackage() {
      return { format: "mp4", filename: `${typeId}.mp4` };
    }
  };
}

test("pool skip seam clears analysis path and questions use skipped branch", () => {
  let session = poolSeam.start("owner-1");
  session = poolSeam.admit(session, [{ id: "m1", kind: "image" }]);
  assert.equal(session.poolMode, "filled");
  session = poolSeam.skip(session);
  assert.equal(session.poolMode, "skipped");
  assert.equal(questionSeam.pathFor(session), "skipped");
  session = questionSeam.answer(session, { purpose: "Launch night", mediaSource: "pexels" });
  assert.equal(session.brief.purpose, "Launch night");
  assert.equal(session.mediaSourcePref, "pexels");
});

test("settings seam only accepts polish-ready registry types", () => {
  const registry = new TypeRegistry();
  registry.register(stubModule("reel_vertical"));
  let session = createSession({ ownerId: "u1", skipPool: true });
  session = settingsSeam.apply(session, { selectedTypeIds: ["reel_vertical"] }, registry);
  assert.deepEqual(session.selectedTypeIds, ["reel_vertical"]);
  assert.throws(
    () => settingsSeam.apply(session, { selectedTypeIds: ["carousel_stills"] }, registry),
    /not polish-ready/
  );
});

test("craft dispatcher fans out via registry without switch(type) and isolates failure", async () => {
  const registry = new TypeRegistry();
  registry.register(stubModule("reel_vertical"));
  registry.register(stubModule("other_video", { fail: true }));
  const dispatcher = new CraftDispatcher(registry, new Gate0Policy({ pexels: true, fal: false }));
  let session = createSession({
    ownerId: "u1",
    skipPool: true,
    brief: { purpose: "Beach launch" },
    mediaSourcePref: "own",
    selectedTypeIds: ["reel_vertical", "other_video"]
  });
  session = withPoolItems(session, [{ id: "photo-1", kind: "image" }]);
  session = await dispatcher.runAll(session);
  assert.equal(session.status, "partial");
  const reel = session.artifacts.find((item) => item.typeId === "reel_vertical");
  const other = session.artifacts.find((item) => item.typeId === "other_video");
  assert.equal(reel?.status, "ready");
  assert.equal(other?.status, "failed");
  assert.match(other?.error ?? "", /boom/);
  assert.equal(reel?.craftPayload?.typeId, "reel_vertical");
});

test("Gate0 blocks Pexels media pref without BYOK", () => {
  const registry = new TypeRegistry();
  registry.register(stubModule("reel_vertical", { mediaRequired: false }));
  const dispatcher = new CraftDispatcher(registry, new Gate0Policy({ pexels: false, fal: false }));
  const session = patchSettings(
    createSession({ ownerId: "u1", skipPool: true, selectedTypeIds: ["reel_vertical"] }),
    { mediaSourcePref: "pexels" }
  );
  assert.throws(() => dispatcher.enqueue(session), Gate0Error);
});
