# f_motion

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Render bench

`lib/render/` is the on-device half of the `render-plan-v1` spike: it parses the
shared plan, compiles it to FFmpeg arguments with the same code path the worker
uses, and renders it with the bundled LGPL FFmpeg build. It adds no UI to the
editor — the bench screen is reached from the app bar and exists to record
timings and output files.

- `lib/render/plan.dart` — plan models, validation, `RenderPlanV1.parse`
- `lib/render/compile.dart` — the Dart mirror of the worker compiler
- `lib/render/render.dart` — job execution, progress, cancel
- `lib/render/device_assets.dart` — bundled assets and synthetic sample media
- `lib/render/bench_page.dart` — the benchmark screen

The Dart compiler is asserted byte-identical to the worker's against
`packages/contracts/fixtures/compile/`:

```sh
flutter test test/render
```

Build and run: `tool/flutter_from_root.sh build-apk` (from the repo root), then
install `build/app/outputs/flutter-apk/app-debug.apk`. Pass
`--dart-define=F_MOTION_RENDER_ENCODER=h264_mediacodec` to pin the device
encoder. Comparing a device reel with the worker's uses
`tool/flutter_from_root.sh compare`; the full procedure, the measured numbers
and the open questions live in `docs/spikes/on-device-render.md`.

Bundled third-party pieces (Inter fonts, FFmpeg Kit) are recorded in
[THIRD_PARTY.md](THIRD_PARTY.md).
