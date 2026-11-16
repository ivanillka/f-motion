# On-device reel rendering spike

Status: **OPEN — feasible in code, not yet run on a phone.** The shared
`render-plan-v1` contract now has two compilers (worker TypeScript, app Dart)
that produce byte-identical FFmpeg argument lists for all four shared fixtures,
and the app renders a plan end to end with an LGPL FFmpeg build. The phone run
itself is manual: there is no Android device in CI, so the numbers this spike
still owes are device timings, device output quality and battery/heat behaviour.

## The question

Can the phone render the reel itself, from the same `render-plan-v1` document
the worker renders, without the output drifting? The spike answers the part that
can be answered in code: *does a device build even accept the plan, and does it
produce the same reel?* It does not yet answer *is it fast enough on the target
phone*.

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
host FFmpeg 8.1.3 (same major version the app ships, 8.1.2) against synthetic
media in the app's own sizes. All four produce a complete reel:

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

The comparison is structural, not byte-wise: same size, frame rate, an audio
stream and audio layout, duration within one frame at 30 fps, frame count
within one, the same number of scene changes, and two floors on the decoded
picture — PSNR (default 28 dB) and luma SSIM (default 0.95). Byte equality is
impossible by design — MediaCodec and libx264 are different encoders — so the
question the tool asks is "same reel, acceptable picture".

Both floors are **provisional**. Nothing has measured a device reel yet, so 28 dB
and 0.95 are a starting guess, not a quality bar the product has agreed to. They
live in `tools/render/compare_render.mjs` as `DEFAULT_MIN_PSNR` and
`DEFAULT_MIN_SSIM`, are overridable per run with `--min-psnr` / `--min-ssim`,
and the tool prints them next to the measured value and marks them provisional
in the report. The file to change when the real numbers land is that pair of
constants.

To calibrate, run the same plan and media on both sides — the worker's reel and
one phone render, three runs of the phone render on a cold device — and take the
median of the three:

```sh
for run in 1 2 3; do
  apps/mobile/tool/flutter_from_root.sh compare \
    --reference worker.mp4 --device "device-$run.mp4" --json "report-$run.json"
done
```

The floor is that median minus 2 dB: the slack absorbs run-to-run encoder
variation without hiding a moved cut, which the structural checks catch on their
own. Replace the constant with the number, say which device and plan it came
from in this file, and drop the word provisional from the help text.

When the two metrics disagree, SSIM wins. PSNR punishes a full-range versus
limited-range mismatch and MediaCodec's rate-control choices with a large
negative number while the picture looks fine; SSIM is far less sensitive to that
and tracks visible damage more closely. Treat a PSNR failure with a passing SSIM
as "check colour range and bitrate", not as a broken render.

Exit codes: `0` for MATCH, `1` for MISMATCH (the failing checks are named, so a
CI log says which one moved), `2` for a usage error, a missing file, or a
missing `ffmpeg`/`ffprobe`.

## What it costs

- The debug APK is 269 MB because it carries every ABI. The arm64 slice alone
  holds 81 MB of native libraries, of which 25 MB is FFmpeg (`libavcodec`
  14.1 MB, `libavformat` 5.6 MB, `libavfilter` 5.2 MB, the rest small). A
  release build with `--split-per-abi` drops the debug engine and the Vulkan
  validation layer, so the shipping number is much lower but still tens of
  megabytes. That is a product decision, not a spike result.
- Licences: the fonts are SIL OFL 1.1, the FFmpeg build is LGPL 3.0 with no GPL
  codecs. Both are recorded in `apps/mobile/THIRD_PARTY.md`.

## Open questions for the design contract

1. **Fonts.** The spike bundles two Inter faces (ExtraBold for titles, SemiBold
   for captions) so the burn is identical on both sides. Is that the brand
   decision, or should the plan name faces the app must already have?
2. **Brand mark.** The mark is a bundled VP9 WebM overlay, not plan data. Should
   the plan carry its own mark ref, or is the mark a property of the app?
3. **Encoder quality.** `h264_mediacodec` gives no rate control as predictable as
   libx264's `-b:v 8M`. The comparison tool gates on PSNR (28 dB) and luma SSIM
   (0.95), both provisional — the calibration procedure is above — so the real
   threshold, and whether device reels need a different bitrate, still needs a
   device run. If the two disagree, SSIM is the one to trust.
4. **iOS.** The package supports it, but the retargeting rules assume device
   encoder names (`h264_mediacodec`, `h264_videotoolbox`) and only the Android
   build was produced; nothing on the iOS path has been exercised.

## Not proven

- Device wall clock for any plan, and how it scales at 1080x1920 output.
- Thermal throttling over repeated renders, and battery cost.
- Device picture quality against either provisional floor: no device reel has
  been compared with `compare_render.mjs` yet, so 28 dB PSNR and 0.95 SSIM are
  unvalidated starting values.
- That MediaCodec accepts every plan in the contract, not just these four
  fixtures.
