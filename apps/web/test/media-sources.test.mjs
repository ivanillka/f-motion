import test from "node:test";
import assert from "node:assert/strict";
import { mediaSourceChips, sourceChipTone } from "../src/media-sources.ts";
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
