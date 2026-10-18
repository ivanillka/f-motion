import test from "node:test";
import assert from "node:assert/strict";
import {
  animateStillsToggleState,
  civitaiPickerParams,
  countStillFiles,
  isReadyStillMedia,
  mediaSourceChips,
  sourceChipTone
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
