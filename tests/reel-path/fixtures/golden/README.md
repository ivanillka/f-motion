# Golden parity fixtures

`golden-still.jpg` is 720x1280, the portrait source size both runtimes receive
in the gate. The browser draws it into a 1080x1920 stage; the worker first
upscales it with Lanczos and then lets `zoompan` sample that, which is the
resampler difference the SSIM floor exists for.

The picture is deliberately busy in the ways a crop or a type change would
show: a top-to-bottom gradient, a soft sun glow, a thin ring, a horizon line,
and large flat color fields. That makes SSIM sensitive to a moved crop, a
typeface change, or a size change, and insensitive to ordinary JPEG noise.

## Regenerate

```sh
node tests/reel-path/fixtures/golden/make-still.mjs
```

The script needs `ffmpeg` on PATH, which the e2e suite already needs. The
committed JPEG is the output of that script; rerun it only when the picture
itself needs to change.

## How the gate uses it

`tests/e2e/web-flow.spec.ts` serves this file for every `.invalid` storage
request, forces the `.preview` element to 1080x1920, and screenshots it at
0, 1.4667, and 3 seconds of a 3.4 second zoom scene. The same file is posted to
the e2e worker, which renders the scene to MP4, and the worker frame is
extracted at the time the preview actually showed. Full-frame RGB SSIM must
stay at or above 0.95. The committed fixture scores about 0.975 in this tree,
so the floor has room for resampler and glyph rasterizer noise, including a
different FFmpeg version on CI, while a moved crop or another type size still
fails.

A mismatch means the browser and FFmpeg disagree about the picture, the crop,
or the type. A resampler difference alone stays above the floor.
When the gate fails, run it with `GOLDEN_PARITY_KEEP=1` to keep the preview and
worker PNGs in the printed temporary directory for inspection.

The e2e worker accepts media paths under either `apps/worker/test/fixtures/` or
`tests/reel-path/fixtures/`, so this file can be rendered without copying it.
