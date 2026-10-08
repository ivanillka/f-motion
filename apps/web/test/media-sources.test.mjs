import test from "node:test";
import assert from "node:assert/strict";
import {
  animateStillsToggleState,
  countStillFiles,
  isReadyStillMedia,
  mediaSourceChips,
  sourceChipTone
} from "../src/media-sources.ts";
// node --experimental-strip-types (see package.json test script)

test("media source chips always include own, pexels, fal, and a future slot", () => {
  const chips = mediaSourceChips({
    ownCount: 0,
    pexelsConnected: false,
    falConnected: false
  });
  assert.deepEqual(chips.map((chip) => chip.id), ["own", "pexels", "fal", "more"]);
  assert.equal(chips.find((chip) => chip.id === "pexels")?.state, "locked");
  assert.equal(chips.find((chip) => chip.id === "more")?.state, "coming");
  assert.equal(sourceChipTone("locked"), "muted");
});

test("connected and pooled sources report ready/connected states", () => {
  const chips = mediaSourceChips({
    ownCount: 3,
    pexelsConnected: true,
    falConnected: true
  });
  assert.equal(chips.find((chip) => chip.id === "own")?.state, "ready");
  assert.match(chips.find((chip) => chip.id === "own")?.detail ?? "", /3/);
  assert.equal(chips.find((chip) => chip.id === "pexels")?.state, "connected");
  assert.equal(chips.find((chip) => chip.id === "fal")?.state, "connected");
  assert.equal(sourceChipTone("connected"), "on");
});

test("unavailable providers stay honest", () => {
  const chips = mediaSourceChips({
    ownCount: 0,
    pexelsConnected: true,
    pexelsUnavailable: true,
    falConnected: false,
    falUnavailable: true
  });
  assert.equal(chips.find((chip) => chip.id === "pexels")?.state, "unavailable");
  assert.equal(chips.find((chip) => chip.id === "fal")?.state, "unavailable");
  assert.equal(sourceChipTone("unavailable"), "warn");
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
  }).reason, /stills/i);
  assert.equal(animateStillsToggleState({
    falConnected: true,
    falUnavailable: false,
    stillCount: 1
  }).enabled, true);
  assert.equal(countStillFiles([{ type: "image/jpeg" }, { type: "video/mp4" }]), 1);
  assert.equal(isReadyStillMedia({ state: "ready", detected: { type: "image/jpeg" } }), true);
  assert.equal(isReadyStillMedia({ state: "ready", detected: { type: "video/mp4" } }), false);
});
