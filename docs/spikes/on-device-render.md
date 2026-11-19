# On-device reel rendering spike

Status: **three of four fixtures render on the Z Flip4 and match the worker's
reel.** The shared `render-plan-v1` contract has two compilers (worker
TypeScript, app Dart) that produce byte-identical FFmpeg argument lists for all
four shared fixtures, and the app rendered three of them on a Samsung Z Flip4
with an LGPL FFmpeg build: `photo-reel`, `brand-mark` and `voice-and-bed` all
pass `compare_render.mjs` against the worker's reel at 30.3–31.7 dB PSNR and
0.99 luma SSIM, in 1.3–8.0 s per reel. The fourth, `contain`, does not render on
the phone at all — the FFmpeg Kit build has no `eq` filter, which that plan's
letterbox dim needs. That gap is the spike's sharpest finding and is written up
below. The phone run stays manual: there is no Android device in CI.

## The question

Can the phone render the reel itself, from the same `render-plan-v1` document
the worker renders, without the output drifting? The spike answers two of the
three parts of that: *does a device build accept the plan* (mostly — one filter
family is missing) and *does it produce the same reel* (yes, within encoder
noise, at 720x1280). It answers *is it fast enough on the target phone* only at
720x1280, where the longest fixture takes under 8 s cold.

## What was built

| File | Role |
| --- | --- |
| `packages/contracts/fixtures/render-plan-v1-*.json` | 4 shared plans: photo reel, brand mark, voice and bed, contain |
| `apps/worker/src/compile-plan.ts` | `compileRenderPlan`: the reference compiler |
| `apps/mobile/lib/render/plan.dart` | `RenderPlanV1.parse` — models, validation, `toJson` |
| `apps/mobile/lib/render/compile.dart` | The Dart mirror of the compiler, plus the compiled job |
| `apps/mobile/lib/render/render.dart` | Runs the job: FFmpeg Kit, per-pass progress, cancel, log tail |
| `apps/mobile/lib/render/device_assets.dart` | Asset materialisation, synthetic sample media, one-call render |
| `apps/mobile/lib/render/bench_page.dart` | The benchmark screen (fixture picker, encoder picker, report) |
| `apps/worker/test/render-plan-compile.mjs` | Records the worker's compiled jobs as goldens |
| `apps/mobile/test/render/*` | Plan parse, compiler parity, executor behaviour |
| `tools/render/compare_render.mjs` | Compares a worker reel with a device reel |
| `tools/render/fixtures/device-scdet-photo-reel.log` | Real `scdet` log from the phone render; pins the scene-cut parser |

## One plan, two compilers, byte-identical arguments

The worker writes its compiled job for every shared fixture into
`packages/contracts/fixtures/compile/`, including the ASS bytes and the concat
list. `apps/mobile/test/render/compile_test.dart` compiles the same plan in Dart
and asserts the argument lists, ASS text and concat list match **byte for
byte**, so a change on either side fails a test instead of quietly producing a
different reel on the phone.

To re-record after an intentional compiler change:

```sh
cd apps/worker && npm run build && node test/render-plan-compile.mjs
cd ../../apps/mobile && flutter test test/render
```

Two details exist only because the two sides run different FFmpeg builds, and
both are additive rather than rewriting the plan:

- The Android build has no `libx264`, so `h264` is retargeted to
  `h264_mediacodec`. `retargetEncoder` rewrites only the output `-c:v` token —
  the first `-c:v` after the last `-i` — so input codecs such as the brand
  mark's VP9 stay untouched. A test asserts every other argument is unchanged.
- The plan's opaque media refs (`still-1`, `music:pulse`, `brand_mark`) are
  resolved against a local map. A ref with no file fails closed in the compiler;
  nothing falls back to a gray frame or a network fetch.

## Evidence collected without a phone

Every shared plan was compiled with the worker compiler and then executed with a
host FFmpeg (8.1.3 at the time of this table; 9.0.2 for the device comparison
below) against synthetic media in the app's own sizes. All four produce a
complete reel:

| Plan | Passes | Wall clock | Output |
| --- | --- | --- | --- |
| `photo-reel` | 3 scenes + concat | 2417 ms | 720x1280, 30 fps, 5.733 s |
| `brand-mark` | 1 scene + concat | 922 ms | 720x1280, 30 fps, 1.834 s |
| `voice-and-bed` | 2 scenes + concat | 948 ms | 720x1280, 30 fps, 2.133 s |
| `contain` | 1 scene + concat | 1083 ms | 720x1280, 30 fps, 1.533 s |

That run exercised the parts that are easy to get wrong and hard to see in unit
tests: libass loaded both bundled Inter files from the plan's `fontsdir` and
resolved `Inter SemiBold` to them, the ASS burn and its karaoke tags rendered,
the VP9 brand mark overlay decoded, the concat list was accepted, and every
output duration is the plan's total plus at most one frame of concat padding. It
is not a device measurement and does not predict MediaCodec speed; it rules out
"the compiled arguments do not run".

The synthetic media generator initially failed here, which is exactly the kind
of bug the run was for: the music bed's `aevalsrc` expression contained a bare
comma (`mod(t,1)`), which a filtergraph reads as a filter separator. It is now
`(t-floor(t))`, and `ensureSampleMedia` throws if FFmpeg produces nothing.

## On the phone: three of four fixtures match

Samsung Z Flip4 (`SM-F721B`, Android 16 / API 36, Snapdragon 8 Gen 1 `taro`),
debug APK from `apps/mobile` built with the default
`F_MOTION_RENDER_ENCODER=h264_mediacodec`, FFmpeg Kit 6.0.LTS (FFmpeg 8.1.2,
libavformat 62.12.102), MediaCodec picking `c2.qti.avc.encoder` (from logcat).
The worker reels were rendered by the worker's compiler on host FFmpeg 9.0.2
against the same media bytes — see "Running the bench" for why that matters.

| Plan | Passes | Device time | Output | PSNR vs worker | luma SSIM |
| --- | --- | --- | --- | --- | --- |
| `photo-reel` | 3 scenes + concat | 5.2–8.0 s (median 5.8 s) | 720x1280, 30 fps, 5.733 s | 30.33 dB | 0.9929 |
| `brand-mark` | 1 scene + concat | 1.6 s | 720x1280, 30 fps, 1.834 s | 30.66 dB | 0.9914 |
| `voice-and-bed` | 2 scenes + concat | 1.3 s | 720x1280, 30 fps, 2.133 s | 31.68 dB | 0.9917 |
| `contain` | 1 scene + concat | — | — | — | — |

All structural checks passed on the three that rendered: same size, frame rate,
audio stream, sample rate and channel count, duration (drift 0.000 s against a
one-frame tolerance), frame count and scene count. The device encoder writes
h264 High@3.1 at 6.69 Mbit/s where libx264 wrote 4.63 Mbit/s from the same
`-b:v 8M` plan; the picture is what the gates measure, and it passes.

Three cold runs of `photo-reel` — app force-stopped and the materialised bundle
deleted, media kept, so only the media pages and the code cache stay warm — took
5794, 5446 and 7356 ms of in-app render time. Battery temperature stayed at
35.1–35.5 °C, the skin sensor moved 37.6 → 39.3 °C and the application
processor 38.1 → 46.2 °C across the three, with no throttle message in logcat.
The spread is wide enough that it does not separate heat from page-cache state;
a longer soak is still owed.

### `contain` fails: the phone has no `eq` filter

`contain` stops before its first frame:

```
[AVFilterGraph @ 0x...] No such filter: 'eq'
Error initializing complex filters.
Filter not found
```

The plan's `fit: "contain"` path dims its letterbox background with
`eq=brightness=-0.14:saturation=0.85` in `apps/mobile/lib/render/compile.dart`.
FFmpeg Kit 6.0.LTS ships without `eq`; the identical argument list runs on the
worker's host FFmpeg. So this is neither a MediaCodec problem nor a plan-contract
problem: it is a filter-availability one, and it means a plan can compile
byte-identically on both sides and still fail on the device. Either that dim
moves to a filter the LGPL build actually ships, or the compiler learns the
device's filter set and rejects the plan at compile time with a named cause
instead of at runtime with "Filter not found".

## Running the bench

```sh
apps/mobile/tool/flutter_from_root.sh build-apk
adb install -r apps/mobile/build/app/outputs/flutter-apk/app-debug.apk
```

The device encoder is chosen at build time when you need to pin one:

```sh
cd apps/mobile && flutter build apk --debug \
  --dart-define=F_MOTION_RENDER_ENCODER=h264_mediacodec
```

Open the render bench from the app bar. Pick a fixture, press Render, and the
screen reports per-pass wall clock, total time, encoder, output size and the
absolute output path. Cancel stops the running pass through FFmpeg Kit.

Outputs land in the app's cache directory:
`<cache>/f-motion-render-bench/reel-<fixture>.mp4`. Pull one with

```sh
adb shell run-as app.fmotion.f_motion cat <path from the report> > device.mp4
```

and compare it with the worker's reel for the same plan and media:

```sh
apps/mobile/tool/flutter_from_root.sh compare \
  --reference worker.mp4 --device device.mp4 --json report.json
```

**Do not let each side generate its own sample media.** FFmpeg 8.1.2 on the
phone and 9.0.2 on the host disagree about what the `gradients` filter draws —
the phone's gradient runs mirrored against the host's — so two independently
generated media sets mean the comparison scores different source pictures:
12.93 dB PSNR and 0.7819 luma SSIM for `photo-reel` that way, against 30.33 dB
and 0.9929 once both sides used the same bytes. Push the worker's media into the
app's cache before the first render; `ensureSampleMedia` skips a ref whose file
already exists, so a pushed file wins:

```sh
for f in still-1.png still-2.png still-3.png clip-2.mp4 voice-1.m4a music-pulse.m4a; do
  adb shell run-as app.fmotion.f_motion tee \
    code_cache/f-motion-render-bench/media/$f < worker-media/$f > /dev/null
done
```

`adb push` into the app's private directory fails with "Permission denied";
`run-as` piping is the route that works on a non-rooted phone.

The scene-count check reads `lavfi.scd.time` out of ffmpeg's `scdet` log, and
its parser is pinned by `tools/render/fixtures/device-scdet-photo-reel.log` — a
real log from the Z Flip4 `photo-reel` render, committed with a test that
asserts its two cuts. A format change therefore fails a test instead of quietly
reporting zero scene changes on both sides and passing.

The comparison is structural, not byte-wise: same size, frame rate, an audio
stream and audio layout, duration within one frame of the reference at the frame
rate ffprobe reports (30 fps for these plans, and a failure names that rate),
frame count within one, the same number of scene changes, and two floors on the
decoded picture — PSNR (default 28.3 dB) and luma SSIM (default 0.972). Byte
equality is impossible by design — MediaCodec and libx264 are different
encoders — so the question the tool asks is "same reel, acceptable picture".

Both floors are **measured**, and the procedure below is how they were derived,
not how they still need to be. They live in
`tools/render/compare_render.mjs` as `DEFAULT_MIN_PSNR` and `DEFAULT_MIN_SSIM`,
are overridable per run with `--min-psnr` / `--min-ssim`, and the tool prints
each floor next to the measured value marked `measured` or `override`, so a run
that quietly relaxed a gate says so in its own output and in the JSON report
(`thresholds.overridden`). Re-measure them on a new device or a new encoder
before trusting them there.

To re-measure, run the same plan and media on both sides — the worker's reel and
three cold runs of the phone render — and take the median of the three:

```sh
for run in 1 2 3; do
  apps/mobile/tool/flutter_from_root.sh compare \
    --reference worker.mp4 --device "device-$run.mp4" --json "report-$run.json"
done
```

The PSNR floor is that median minus 2 dB: the slack absorbs run-to-run encoder
variation without hiding a moved cut, which the structural checks catch on their
own. The SSIM floor is the same three-run median minus **0.02** luma — a fixed
decrement, not the observed spread, so three runs that happen to agree closely do
not end up with a floor pinned to their own exact value.

For `photo-reel` on the Z Flip4 the cold runs scored 30.33 dB and 0.9929 against
the worker's reel, and that is where 28.3 dB and 0.972 come from. `brand-mark`
and `voice-and-bed` came in slightly higher (30.66 and 31.68 dB, 0.9914 and
0.9917), so the floors are not tight against the other fixtures.

When the two metrics disagree, SSIM wins. PSNR punishes a full-range versus
limited-range mismatch and MediaCodec's rate-control choices with a large
negative number while the picture looks fine; SSIM is far less sensitive to that
and tracks visible damage more closely. Treat a PSNR failure with a passing SSIM
as "check colour range and bitrate", not as a broken render.

Exit codes: `0` for MATCH, `1` for MISMATCH (the failing checks are named, so a
CI log says which one moved), `2` for a usage error, a missing file, or a
missing `ffmpeg`/`ffprobe`.

## What it costs

- The debug APK is 279 MiB (292,302,806 bytes) because it carries both ABIs.
  The arm64 slice is 77.2 MB of files, the armeabi-v7a slice 79.2 MB; of the
  arm64 native libraries 25.4 MB is FFmpeg (`libavcodec` 14.05 MB,
  `libavformat` 5.57 MB, `libavfilter` 5.21 MB, the rest small), and the debug
  Flutter engine (37.6 MB) plus the Vulkan validation layer (15.2 MB) make up
  most of the remainder. A release build with `--split-per-abi` drops the debug
  engine and the validation layer, so the shipping number is much lower but
  still tens of megabytes. That is a product decision, not a spike result.
- Licences: the fonts are SIL OFL 1.1, the FFmpeg build is LGPL 3.0 with no GPL
  codecs. Both are recorded in `apps/mobile/THIRD_PARTY.md`.

## Open questions for the design contract

1. **Fonts.** The spike bundles two Inter faces (ExtraBold for titles, SemiBold
   for captions) so the burn is identical on both sides. Is that the brand
   decision, or should the plan name faces the app must already have?
2. **Brand mark.** The mark is a bundled VP9 WebM overlay, not plan data. Should
   the plan carry its own mark ref, or is the mark a property of the app?
3. **Encoder quality.** `h264_mediacodec` gives no rate control as predictable as
   libx264's `-b:v 8M`: on `photo-reel` the phone wrote 6.69 Mbit/s at
   h264 High@3.1 where libx264 wrote 4.63 Mbit/s, and still scored 30.33 dB /
   0.9929 against it, so the floors (28.3 dB, 0.972) hold on this device.
   Whether a *device* reel should target a different bitrate — or whether the
   worker should accept MediaCodec's bitrate drift as normal — is a product
   question the measurements do not settle.
4. **Filter set.** The phone's FFmpeg build is not the worker's: `eq` is missing,
   and `contain` cannot render because of it. Does the compiler carry a device
   filter allowlist and reject unsupported plans at compile time, do the plans
   avoid filters outside an agreed subset, or does the app ship a fuller
   `lavfi` build? This is the one finding that makes "byte-identical arguments"
   insufficient on its own.
5. **iOS.** The package supports it, but the retargeting rules assume device
   encoder names (`h264_mediacodec`, `h264_videotoolbox`) and only the Android
   build was produced; nothing on the iOS path has been exercised.

## Not proven

- Device wall clock at 1080x1920, or on a phone other than a Z Flip4. Every
  number here is 720x1280 on one Snapdragon 8 Gen 1 device.
- Thermal behaviour over a longer soak. Three cold `photo-reel` runs moved the
  application processor 38.1 → 46.2 °C with no throttle message, but the
  run-to-run spread (5.2–8.0 s) does not separate heat from page-cache state.
- That the phone's FFmpeg build accepts every plan in the contract. `contain`
  already shows the opposite for one filter, and nothing enumerates the filter
  set the LGPL build actually ships.
