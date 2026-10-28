import test from "node:test";
import assert from "node:assert/strict";
import {
  animateStillsToggleState,
  civitaiPickerParams,
  countStillFiles,
  isReadyStillMedia,
  mediaSourceChips,
  readRememberedVisualSource,
  rememberVisualSource,
  sourceChipTone,
  visualSourceOptions,
  VISUAL_SOURCE_STORAGE_KEY
} from "../src/media-sources.ts";
// node --experimental-strip-types (see package.json test script)

test("media source chips always include own, pexels, civitai, fal, and a future slot", () => {
  const chips = mediaSourceChips({
    ownCount: 0,
    pexelsConnected: false,
    civitaiConnected: false,
    falConnected: false
  });
  assert.deepEqual(chips.map((chip) => chip.id), ["own", "pexels", "civitai", "fal", "more"]);
  assert.equal(chips.find((chip) => chip.id === "pexels")?.state, "locked");
  assert.equal(chips.find((chip) => chip.id === "civitai")?.state, "locked");
  assert.equal(chips.find((chip) => chip.id === "more")?.state, "coming");
  assert.equal(sourceChipTone("locked"), "muted");
});

test("connected and pooled sources report ready/connected states", () => {
  const chips = mediaSourceChips({
    ownCount: 3,
    pexelsConnected: true,
    civitaiConnected: true,
    falConnected: true
  });
  assert.equal(chips.find((chip) => chip.id === "own")?.state, "ready");
  assert.match(chips.find((chip) => chip.id === "own")?.detail ?? "", /3/);
  assert.equal(chips.find((chip) => chip.id === "pexels")?.state, "connected");
  assert.equal(chips.find((chip) => chip.id === "civitai")?.state, "connected");
  assert.equal(chips.find((chip) => chip.id === "fal")?.state, "connected");
  assert.equal(sourceChipTone("connected"), "on");
});

test("unavailable Civitai is hidden and others stay honest", () => {
  const chips = mediaSourceChips({
    ownCount: 0,
    pexelsConnected: true,
    pexelsUnavailable: true,
    civitaiConnected: true,
    civitaiUnavailable: true,
    falConnected: false,
    falUnavailable: true
  });
  assert.equal(chips.some((chip) => chip.id === "civitai"), false);
  assert.equal(chips.find((chip) => chip.id === "pexels")?.state, "unavailable");
  assert.equal(chips.find((chip) => chip.id === "fal")?.state, "unavailable");
  assert.equal(sourceChipTone("unavailable"), "warn");
});

test("keyless Civitai remains available at the safe levels", () => {
  const chips = mediaSourceChips({
    ownCount: 0,
    pexelsConnected: false,
    civitaiConnected: false,
    civitaiKeyless: true,
    falConnected: false
  });
  assert.equal(chips.find((chip) => chip.id === "civitai")?.state, "connected");
  assert.equal(chips.find((chip) => chip.id === "civitai")?.detail, "Keyless");
});

test("Civitai picker carries filters and cursor paging", () => {
  const params = civitaiPickerParams({
    query: "harbor night",
    orientation: "landscape",
    username: "alice",
    sort: "Newest",
    period: "Week",
    nsfw: "Soft",
    cursor: "feed:1",
    modelId: 11
  });
  assert.equal(params.get("q"), "harbor night");
  assert.equal(params.get("orientation"), "landscape");
  assert.equal(params.get("username"), "alice");
  assert.equal(params.get("sort"), "Newest");
  assert.equal(params.get("period"), "Week");
  assert.equal(params.get("nsfw"), "Soft");
  assert.equal(params.get("cursor"), "feed:1");
  assert.equal(params.get("model_id"), "11");
  assert.equal(params.get("limit"), "12");
});

test("animate stills toggle stays off unless FAL is connected and pool has stills", () => {
  assert.equal(animateStillsToggleState({
    falConnected: false,
    falUnavailable: false,
    stillCount: 2
  }).enabled, false);
  assert.match(animateStillsToggleState({
    falConnected: true,
    falUnavailable: false,
    stillCount: 0
  }).reason, /add photos first/i);
  assert.equal(animateStillsToggleState({
    falConnected: true,
    falUnavailable: false,
    stillCount: 1
  }).enabled, true);
  assert.equal(countStillFiles([{ type: "image/jpeg" }, { type: "video/mp4" }]), 1);
  assert.equal(isReadyStillMedia({ state: "ready", detected: { type: "image/jpeg" } }), true);
  assert.equal(isReadyStillMedia({ state: "ready", detected: { type: "video/mp4" } }), false);
});

test("picture answers stay truthful when nothing is connected", () => {
  const options = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: false,
    civitaiConnected: false,
    falConnected: false
  });
  assert.deepEqual(options.choices.map((choice) => choice.id), ["own"]);
  assert.deepEqual(options.connected, []);
  assert.equal(
    options.hint,
    "Connect Pexels, Civitai and FAL in Settings to use them here."
  );
  // The "More" slot is a promise, never an answer.
  assert.equal(options.choices.some((choice) => choice.label.includes("New options")), false);
});

test("picture answers list every connected source and keep locked ones in the hint", () => {
  const options = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: true
  });
  assert.deepEqual(options.choices.map((choice) => choice.id), ["pexels", "fal", "own", "mix"]);
  assert.deepEqual(options.connected, ["Pexels", "FAL"]);
  assert.equal(options.hint, "Connect Civitai in Settings to use it here.");
  assert.equal(options.choices[1].label, "AI images with FAL (paid, asks first)");
  assert.match(options.choices[1].label, /asks first/);
});

test("the hint names one locked source, or both, and points at Settings", () => {
  const one = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: true
  });
  assert.equal(one.hint, "Connect Civitai in Settings to use it here.");
  const two = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: false
  });
  assert.equal(two.hint, "Connect Civitai and FAL in Settings to use them here.");
  // "Settings" is the studio's own name for the screen that holds the keys.
  assert.doesNotMatch(two.hint, /\bSources\b/);
});

test("keyless Civitai answers in the middle, and unavailable sources are named apart", () => {
  const options = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    civitaiKeyless: true,
    falConnected: false,
    falUnavailable: true
  });
  assert.deepEqual(options.choices.map((choice) => choice.id), ["pexels", "civitai", "own", "mix"]);
  assert.equal(options.hint, "FAL is not available here.");
  assert.equal(options.choices[1].where, "Civitai images");
});

test("one mix answer covers every connected source, with or without photos", () => {
  const withPhotos = visualSourceOptions({
    ownCount: 2,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: true
  });
  assert.deepEqual(withPhotos.choices.map((choice) => choice.id), ["own", "pexels", "fal", "mix"]);
  assert.equal(withPhotos.choices[3].label, "Mix my photos and Pexels and FAL");
  assert.equal(withPhotos.choices[3].where, "your photos and Pexels and FAL");
  // The answer is offered before the photos are added too: the chat then asks
  // for them instead of filling the storyboard from the external source alone.
  const withoutPhotos = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: true
  });
  assert.deepEqual(withoutPhotos.choices.map((choice) => choice.id), ["pexels", "fal", "own", "mix"]);
  assert.equal(withoutPhotos.choices[3].label, "Mix my photos and Pexels and FAL");
  const pexelsOnly = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: false
  });
  assert.equal(pexelsOnly.choices.find((choice) => choice.id === "mix")?.label, "Mix my photos and Pexels");
  const noExternal = visualSourceOptions({
    ownCount: 2,
    pexelsConnected: false,
    civitaiConnected: false,
    falConnected: false
  });
  assert.equal(noExternal.choices.some((choice) => choice.id === "mix"), false);
});

test("the remembered source leads, but only while it is still connected", () => {
  const remembered = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: true,
    remembered: "fal"
  });
  assert.deepEqual(remembered.choices.map((choice) => choice.id), ["fal", "pexels", "own", "mix"]);
  const disconnected = visualSourceOptions({
    ownCount: 0,
    pexelsConnected: true,
    civitaiConnected: false,
    falConnected: false,
    remembered: "fal"
  });
  assert.deepEqual(disconnected.choices.map((choice) => choice.id), ["pexels", "own", "mix"]);
});

test("the remembered source round trips through storage and ignores junk", () => {
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key)
  };
  assert.equal(readRememberedVisualSource(storage), undefined);
  rememberVisualSource("civitai", storage);
  assert.equal(store.get(VISUAL_SOURCE_STORAGE_KEY), "civitai");
  assert.equal(readRememberedVisualSource(storage), "civitai");
  rememberVisualSource(undefined, storage);
  assert.equal(readRememberedVisualSource(storage), undefined);
  store.set(VISUAL_SOURCE_STORAGE_KEY, "dropbox");
  assert.equal(readRememberedVisualSource(storage), undefined);
});
