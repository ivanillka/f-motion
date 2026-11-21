import test from "node:test";
import assert from "node:assert/strict";
import {
  OVERLAY_MIN_SCALE,
  OVERLAY_PILL_ALPHA,
  OVERLAY_PLAYRES_HEIGHT,
  OVERLAY_PLAYRES_WIDTH,
  OVERLAY_SAFE_INSET,
  OVERLAY_SPOKEN_SECONDARY,
  SPOKEN_SIDE_MARGIN,
  chunkOverlayWord,
  fitOverlayText,
  overlayAlign,
  overlayFit,
  overlayPillPad,
  overlayPlacement,
  overlaySafeWidth,
  overlaySideMargin,
  overlayStyleBox,
  overlayType,
  seekSceneVisual
} from "../dist/index.js";

const scene = {
  id: "s1", order: 0, caption: "Hello", duration_ms: 1000,
  focal_x: 0.5, focal_y: 0.5, motion: "none", audio_level: 1, ducking: false
};

test("every look prints the ASS size the export has always used", () => {
  const sizes = { caption: [64, 26], title: [78, 26], poster: [52, 26], spoken: [68, 68] };
  for (const [look, [title, caption]] of Object.entries(sizes)) {
    assert.equal(overlayType[look].title.size, title, `${look} title`);
    assert.equal(overlayType[look].caption.size, caption, `${look} caption`);
  }
  // Only the title look uppercases, and only its headline.
  assert.equal(overlayType.title.title.uppercase, true);
  for (const look of ["caption", "poster", "spoken"]) {
    assert.equal(overlayType[look].title.uppercase, false, look);
    assert.equal(overlayType[look].caption.uppercase, false, look);
  }
});

test("the caption look and the title look share one square pill", () => {
  // The same face object, so a change to the pill reaches both looks.
  assert.equal(overlayType.caption.caption, overlayType.title.caption);
  for (const look of ["caption", "title"]) {
    const pill = overlayType[look].caption;
    assert.equal(pill.borderStyle, 3, look);
    assert.equal(pill.outline, 8, look);
    assert.equal(pill.shadow, 0, look);
    // 62% opaque black, with the ASS alpha inverted.
    assert.equal(OVERLAY_PILL_ALPHA, 0.62);
    assert.equal(pill.back, "&H61000000");
    assert.ok(Math.abs(pill.size * overlayPillPad(look) - pill.outline) < 1e-12);
  }
  // The faces without a box have no pad, so the studio draws no plate.
  for (const look of ["poster", "spoken"]) {
    assert.equal(overlayType[look].caption.borderStyle, 1, look);
    assert.equal(overlayPillPad(look), 0, look);
  }
});

test("spoken words print in the headline face and fade the words already read", () => {
  const spoken = overlayType.spoken;
  assert.equal(spoken.caption.assFont, spoken.title.assFont);
  assert.equal(spoken.caption.size, spoken.title.size);
  assert.equal(spoken.caption.spacing, spoken.title.spacing);
  assert.equal(overlayPillPad("spoken"), 0);
  assert.equal(OVERLAY_SPOKEN_SECONDARY, "&H80FFFFFF");
  assert.equal(spoken.caption.secondary, OVERLAY_SPOKEN_SECONDARY);
  for (const look of ["caption", "title", "poster"]) {
    assert.notEqual(overlayType[look].caption.secondary, OVERLAY_SPOKEN_SECONDARY, look);
  }
});

test("six percent a side, and eighty PlayRes units for spoken", () => {
  assert.equal(OVERLAY_SAFE_INSET, 0.06);
  assert.equal(OVERLAY_PLAYRES_WIDTH, 720);
  assert.equal(OVERLAY_PLAYRES_HEIGHT, 1280);
  assert.equal(SPOKEN_SIDE_MARGIN, 80);
  // Portrait: ceil(720 * 0.06) = 44 a side, 632 wide.
  assert.equal(overlaySideMargin(720), 44);
  assert.equal(overlaySafeWidth(720), 632);
  // Spoken keeps its 80, which is wider than the 6% inset.
  assert.equal(overlaySideMargin(720, "spoken"), 80);
  assert.equal(overlaySafeWidth(720, "spoken"), 560);
  // Landscape prints on its own width, so the inset is its 6% alone.
  assert.equal(overlaySideMargin(1920), 116);
  assert.equal(overlaySideMargin(1920, "spoken"), 116);
  assert.equal(overlaySafeWidth(1920), 1688);
});

test("each look prints the alignment and margins its style carries", () => {
  assert.deepEqual(overlayStyleBox("spoken"), { align: 5, marginL: 80, marginR: 80, marginV: 0 });
  for (const look of ["caption", "title", "poster"]) {
    assert.deepEqual(overlayStyleBox(look), { align: 2, marginL: 44, marginR: 44, marginV: 140 }, look);
  }
  // A landscape style measures its own margins.
  assert.deepEqual(overlayStyleBox("caption", 1920), { align: 2, marginL: 116, marginR: 116, marginV: 140 });
});

test("every dialogue is placed with the numbers the stage reads", () => {
  assert.equal(overlayAlign("spoken", "bottom"), 5);
  assert.equal(overlayAlign("poster", "top"), 7);
  assert.equal(overlayAlign("poster", "center"), 4);
  assert.equal(overlayAlign("poster", "bottom"), 1);
  assert.equal(overlayAlign("caption", "top"), 8);

  // A zero vertical margin falls back to the style's own 140, which is how the
  // exporter has always stacked a title above a bottom caption.
  const centred = { align: 2, marginL: 0, marginR: 0, marginV: 0 };
  assert.deepEqual(overlayPlacement("caption", "bottom", true, false), { ...centred, titleV: 0, captionV: 0 });
  assert.deepEqual(overlayPlacement("caption", "bottom", true, true), { ...centred, titleV: 228, captionV: 0 });
  assert.deepEqual(overlayPlacement("title", "top", true, true), { ...centred, align: 8, titleV: 88, captionV: 176 });
  assert.deepEqual(overlayPlacement("title", "center", false, false), { ...centred, align: 8, titleV: 560, captionV: 560 });
  assert.deepEqual(overlayPlacement("title", "center", true, true), { ...centred, align: 8, titleV: 500, captionV: 590 });
  // A poster's lower third sits 36 up, and its title 96 above that.
  assert.deepEqual(overlayPlacement("poster", "bottom", true, true), { align: 1, marginL: 0, marginR: 0, marginV: 0, titleV: 96, captionV: 36 });
  assert.deepEqual(overlayPlacement("poster", "top", true, true), { align: 7, marginL: 0, marginR: 0, marginV: 0, titleV: 36, captionV: 110 });
  assert.deepEqual(overlayPlacement("spoken", "center", false, true), { align: 5, marginL: 80, marginR: 80, marginV: 0, titleV: 0, captionV: 0 });
});

test("a word too wide for the safe box shrinks the line before it is split", () => {
  assert.deepEqual(fitOverlayText(["one", "two"], 26, 632), {});
  // 55 characters at 26 units overrun 632, but the line still fits at 60% and
  // takes a size override rather than a break.
  const shrunk = fitOverlayText(["x".repeat(55)], 26, 632);
  assert.equal(shrunk.chunk, undefined);
  assert.ok(shrunk.fontSize !== undefined && shrunk.fontSize < 26);
  assert.ok(shrunk.fontSize >= Math.floor(26 * OVERLAY_MIN_SCALE));
  // 200 characters stay too wide even then, so the word is hard-broken.
  const long = "x".repeat(200);
  const split = fitOverlayText([long], 26, 632);
  assert.equal(split.fontSize, undefined);
  assert.equal(split.chunk, 32);
  const pieces = chunkOverlayWord(long, split.chunk);
  assert.equal(pieces.length, 7);
  assert.deepEqual(pieces.map((piece) => piece.length), [32, 32, 32, 32, 32, 32, 8]);
  assert.equal(pieces.join(""), long);
  assert.deepEqual(chunkOverlayWord("short", split.chunk), ["short"]);
});

test("the fit is measured against the look's own size and safe width", () => {
  // Six characters of spoken type are 306 units wide, well inside 560.
  assert.deepEqual(overlayFit("spoken", "caption", ["x".repeat(6)]), {});
  // Forty characters of caption type overrun 632 and shrink to 21 units.
  assert.deepEqual(overlayFit("caption", "caption", ["x".repeat(40)]), { fontSize: 21 });
});

test("the seek reports the overlay this module prints", () => {
  const portrait = seekSceneVisual(scene, 0, {}, { width: 1080, height: 1920 });
  assert.deepEqual(portrait.overlay.playRes, { width: 720, height: 1280 });
  assert.equal(portrait.overlay.look, "caption");
  assert.equal(portrait.overlay.place, "bottom");
  assert.equal(portrait.overlay.align, 2);
  assert.ok(Math.abs(portrait.overlay.titleSize - 64 / 720) < 1e-12);
  assert.ok(Math.abs(portrait.overlay.captionSize - 26 / 720) < 1e-12);
  assert.ok(Math.abs(portrait.overlay.safeWidth - 632 / 720) < 1e-12);
  assert.ok(Math.abs(portrait.overlay.safeInset - 44 / 720) < 1e-12);

  // A landscape reel prints on its own width, which is the canvas the worker's
  // ASS uses for the same export.
  const wide = seekSceneVisual({ ...scene, overlay_look: "poster" }, 0, {}, { width: 1920, height: 1080 });
  assert.deepEqual(wide.overlay.playRes, { width: 1920, height: 1080 });
  assert.equal(wide.overlay.align, 1);
  assert.ok(Math.abs(wide.overlay.titleSize - 52 / 1920) < 1e-12);

  // A title defaults to the middle, and spoken ignores the stored place.
  assert.equal(seekSceneVisual({ ...scene, overlay_look: "title" }, 0).overlay.place, "center");
  const spoken = seekSceneVisual({ ...scene, overlay_look: "spoken", overlay_place: "top" }, 0);
  assert.equal(spoken.overlay.place, "center");
  assert.equal(spoken.overlay.align, 5);
  assert.ok(Math.abs(spoken.overlay.captionSize - 68 / 720) < 1e-12);
  assert.ok(Math.abs(spoken.overlay.safeWidth - 560 / 720) < 1e-12);
});
