import test from "node:test";
import assert from "node:assert/strict";
import { TypeRegistry } from "@f-engine/content-type-contract";
import {
  CraftDispatcher,
  Gate0Policy,
  createSession,
  settingsSeam,
  withPoolItems
} from "@f-engine/create-session";
// settingsSeam used for animateStills typeSettings
import {
  REEL_VERTICAL_TYPE_ID,
  isReelCraftPayload,
  qaReelCraft,
  registerReelVertical,
  reelVerticalModule,
  uniqueAttachPlan
} from "../dist/index.js";

test("reel module registers as polish-ready and is the only default type", () => {
  const registry = new TypeRegistry();
  registerReelVertical(registry);
  assert.deepEqual(registry.listPolishReady().map((item) => item.typeId), [REEL_VERTICAL_TYPE_ID]);
  assert.equal(registry.require(REEL_VERTICAL_TYPE_ID).editorModel, "storyboard");
  assert.equal(reelVerticalModule.phase, "polish_ready");
});

test("unique attach never repeats media across scenes", () => {
  const scenes = [
    { id: "s1" },
    { id: "s2" },
    { id: "s3" }
  ];
  const ranked = [
    { id: "m1", score: 3 },
    { id: "m2", score: 2 },
    { id: "m1", score: 1 }
  ];
  const plan = uniqueAttachPlan(scenes, ranked);
  assert.deepEqual(plan.map((item) => item.mediaId), ["m1", "m2", undefined]);
});

test("dispatcher runs reel craft through registry and produces storyboard payload", async () => {
  const registry = new TypeRegistry();
  registerReelVertical(registry);
  const dispatcher = new CraftDispatcher(registry, new Gate0Policy({ pexels: true, fal: true }));
  let session = createSession({
    ownerId: "owner",
    skipPool: true,
    brief: { purpose: "Sunset beach launch for customers" },
    mediaSourcePref: "own"
  });
  session = withPoolItems(session, [
    { id: "photo-a", kind: "image", score: 0.9 },
    { id: "photo-b", kind: "image", score: 0.8 },
    { id: "photo-c", kind: "image", score: 0.7 }
  ]);
  session = settingsSeam.apply(
    session,
    {
      selectedTypeIds: [REEL_VERTICAL_TYPE_ID],
      typeSettings: { [REEL_VERTICAL_TYPE_ID]: { durationSeconds: 15, uniqueAttach: true } }
    },
    registry
  );
  session = await dispatcher.runAll(session);
  assert.equal(session.status, "done");
  assert.equal(session.artifacts.length, 1);
  const artifact = session.artifacts[0];
  assert.equal(artifact.typeId, REEL_VERTICAL_TYPE_ID);
  assert.equal(artifact.status, "ready");
  assert.ok(isReelCraftPayload(artifact.craftPayload));
  assert.equal(artifact.craftPayload.architecture.delivery, "reel");
  assert.ok(artifact.craftPayload.scenes.length >= 1);
  assert.equal(qaReelCraft(artifact.craftPayload, session.mediaCatalog), "ready");
  const mediaIds = artifact.craftPayload.mediaAttach.map((item) => item.mediaId).filter(Boolean);
  assert.equal(new Set(mediaIds).size, mediaIds.length);
});

test("reel validateSettings rejects unknown keys", () => {
  const session = createSession({ ownerId: "u", skipPool: true });
  const result = reelVerticalModule.validateSettings(session, { nope: true });
  assert.equal(result.ok, false);
});

test("reel settings accept animateStills and stamp craft payload", async () => {
  const registry = new TypeRegistry();
  registerReelVertical(registry);
  const dispatcher = new CraftDispatcher(registry, new Gate0Policy({ pexels: true, fal: true }));
  let session = createSession({
    ownerId: "owner",
    skipPool: true,
    brief: { purpose: "Portrait stills for a launch" },
    mediaSourcePref: "own",
    selectedTypeIds: [REEL_VERTICAL_TYPE_ID]
  });
  session = settingsSeam.apply(
    session,
    {
      selectedTypeIds: [REEL_VERTICAL_TYPE_ID],
      typeSettings: { [REEL_VERTICAL_TYPE_ID]: { durationSeconds: 15, animateStills: true } }
    },
    registry
  );
  session = withPoolItems(session, [{ id: "still-a", kind: "image", score: 1 }]);
  assert.equal(reelVerticalModule.validateSettings(session, { animateStills: true }).ok, true);
  session = await dispatcher.runAll(session);
  assert.equal(session.artifacts[0]?.craftPayload?.animateStills, true);
});
