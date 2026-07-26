import test from "node:test";
import assert from "node:assert/strict";
import { bounded, clamp, defaultDraft, median, nextUpload, p95, parseDraft, reorder, shouldLoop, slowThreshold } from "./logic.js";

test("bounded samples evict and retain latest 20", () => assert.deepEqual([...Array(21).keys()].reduce((a, n) => bounded(a, n), []), [...Array(20).keys()].map(n => n + 1)));
test("median handles empty, odd and even", () => { assert.equal(median([]), 0); assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 3, 2]), 2.5); });
test("nearest-rank p95 handles empty and 20 samples", () => { assert.equal(p95([]), 0); assert.equal(p95([...Array(20)].map((_, n) => n + 1)), 19); });
test("slow threshold uses calibrated median and floor", () => { assert.equal(slowThreshold([10, 10, 10]), 20); assert.equal(slowThreshold([20, 20, 20]), 30); });
test("reorder preserves stable scene IDs", () => assert.deepEqual(reorder(["purple", "green"], "green"), ["green", "purple"]));
test("focal values clamp", () => { assert.equal(clamp(-2), -1); assert.equal(clamp(2), 1); });
test("draft validates and invalid storage falls back", () => { assert.equal(parseDraft(JSON.stringify({ ...defaultDraft, focalX: 2 })).focalX, 1); assert.deepEqual(parseDraft('{"caption":"'.concat("x".repeat(81), '"}')), defaultDraft); });
test("upload fails at 40 and retry completes at 100", () => { let state = { progress: 0, failed: false }; while (!state.failed) state = nextUpload(state); assert.equal(state.progress, 40); state = { ...state, retried: true, failed: false }; while (state.progress < 100) state = nextUpload(state); assert.equal(state.progress, 100); });
test("reduced motion disables automatic loop", () => { assert.equal(shouldLoop(true), false); assert.equal(shouldLoop(false), true); });
