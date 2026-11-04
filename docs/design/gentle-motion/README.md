# Gentle motion: a smaller default zoom, and a quiet corner mark

Two stills of the same scene at 1080x1920, 1200ms, centred focal point, no caption
and no watermark, plus one corner crop of the wordmark. Everything here is rendered
from files already in the repo, so the numbers can be reproduced offline: the text
bars come from `apps/worker/test/fixtures/edge-text.jpg` and the photo from
`apps/web/public/web/assets/demo-reel.jpg`.

| Still | What is in it |
| --- | --- |
| `zoom-before-after.png` | 2x2 grid of the demo photo. Top row **strong** (first, last frame), bottom row **gentle** (first, last). Both presets start at 1.0, so the left column is the same picture twice; only the last frame differs. |
| `push-text-before-after.png` | Four cells of the top 30% of the text-bar still: **strong** first and last, then **gentle** first and last. |
| `mark-corner.png` | The top right corner at 1:1 pixels, three rows: **compact** (new default), **standard**, and the **old 42% card at full alpha**. |

## What changed

- **Motion strength.** `gentle` is now the default: zoom 1.00 to 1.06, pan held at
  1.06. It keeps 89% of the picture area (11% discarded). `strong` is the old Ken
  Burns and stays reachable per brief: zoom to 1.30 (41% discarded), pan at 1.25
  (36% discarded).
- **The mark.** `compact` is the default: a fifth of the frame wide, 4% in from the
  right, 3.5% down, at 0.45 alpha. `standard` keeps the old 42% width but now also
  draws at 0.45, where it used to be 1.00, so the card no longer covers the picture.
- **The preview** samples the same presets through `--zoom-from`, `--zoom-to` and
  `--pan-scale`, and its push keyframes pan in the same direction as the export.

## Before and after, measured

SSIM between the before render (`strong`) and the after render (`gentle`) at the
same moment of the same scene, computed with

```
ffmpeg -v info -i strong.png -i gentle.png -lavfi "[0:v][1:v]ssim" -f null -
```

| Fixture | Motion | 0% | 50% | 100% |
| --- | --- | --- | --- | --- |
| edge-text | zoom | 1.000000 | 0.943850 | 0.968861 |
| edge-text | zoom_out | 0.969271 | 0.942977 | 0.999415 |
| edge-text | push | 0.951134 | 0.962043 | 0.975653 |
| demo-reel | zoom | 1.000000 | 0.198313 | 0.166336 |
| demo-reel | zoom_out | 0.198743 | 0.201286 | 0.958564 |
| demo-reel | push | 0.217830 | 0.178880 | 0.180690 |

The cells that should be identical are: `zoom` at 0% (both start at 1.0) and
`zoom_out` at 100% (both end at 1.0). They read 1.000 and 0.959, so the harness is
comparing real frames of the same size and the low cells are the picture, not the
measurement.

Read those low cells as *how different the two renders are*, not as quality. SSIM
between two renders is not monotonic in the amount of motion: a 1.30 crop throws
away detail and blurs what is left, and a blurred frame can score *higher* against
another blurred frame than a crisp 1.06 frame does against its own end state. That
is why the demo photo reads 0.17 to 0.22 in the middle of a scene: a 1.30 crop and
a 1.06 crop of a detailed facade are simply different pictures, which is the point
of the change.

## Text at the edge

Bright rows of the text-bar still (mean grey of 200 or more), as fractions of the
frame height, measured with

```
ffmpeg -v error -ss 1.16 -i render.mp4 -frames:v 1 -vf format=gray -f rawvideo -
```

| Motion | Preset | First frame | Last frame |
| --- | --- | --- | --- |
| zoom | strong | 1.0-2.2%, 9.0-12.0% | none |
| zoom | gentle | 1.0-2.2%, 9.0-12.0% | 6.6-9.7% |
| zoom_out | strong | none | 1.0-2.2%, 9.0-12.0% |
| zoom_out | gentle | 6.6-9.7% | 1.0-2.2%, 9.0-12.0% |
| push | strong | 1.3-2.8%, 11.3-15.0% | none |
| push | gentle | 1.0-2.3%, 9.6-12.7% | 3.6-6.7% |

`strong` loses both bars by the end of every scene. `gentle` always keeps one, and
in `push` it keeps it at 3.6-6.7% of the height, inside the 6% overlay safe inset
that the caption and the mark are laid out against. The bar at 1 to 2% of the
height is above that inset in the source picture, so no preset can hold it.

## The mark

`mark-corner.png` crops 600x200 at (460, 40) from the first frame of three renders
of the same scene, so the three rows are the same pixels of the same picture.

Compact draws the 960x200 asset 216px wide, ending 5.8% down the frame. Standard
draws it 454px wide, ending 9.9% down. The bottom row is the old card (454px wide,
96px top, `colorchannelmixer=aa=1.00`) rebuilt with the shipped overlay chain,
because the old full-strength opacity is no longer reachable from the code:

```
[1:v]scale=454:-1:flags=lanczos,format=yuva420p,colorchannelmixer=aa=1.00[mark];
[0:v][mark]overlay=main_w-overlay_w-65:96:shortest=1:format=auto
```

The asset is a card lockup, so at 0.45 alpha the card itself fades into the picture
and only the wordmark reads; at 1.00 it stays a black plate over the top right.

## Checking it by hand

1. Render a reel with the default brief and a still whose text runs to the top edge.
2. The whole scene should end with the text still inside the frame, and the zoom
   should read as a drift rather than a push.
3. Set the brief to `strong` and render again: the same scene now ends tighter and
   the edge text goes with it.
4. On both, the wordmark sits in the top right corner as a quiet credit.

`tests/e2e/web-flow.spec.ts` covers the preview side in `the studio preview draws
the same frame as the worker for every motion in both presets`, which reads the
rendered transform at 0, 50 and 100% for zoom, zoom_out and push in both presets and
compares it with the worker's zoompan maths. `apps/worker/test/worker.test.mjs`
pins the export side: the pan tests now assert that the window starts on the leading
edge of the overscan and ends on the trailing one, for wide and tall stills alike.
