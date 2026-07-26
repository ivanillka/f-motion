# Flutter media feasibility spike

Status: **STOPPED pending repeat physical-device validation and complete
measurements**. The initial static run had no `adb`, Android SDK,
Chrome/Chromium, or connected Android device. A later Samsung SM-F721B run
exposed the fixture issue documented below; no Android or browser feasibility
result is inferred yet.

## Scope proven in code

The spike has two locally bundled 9:16 H.264 MP4 scenes and implements playback,
pause, seek, scene switching and reorder, focal-point crop controls, an
80-character overlay inside visible safe-area bounds, approximate embedded-audio
volume/ducking, a responsive split/stacked editor, persisted draft restore, and
a mock signed upload that deliberately fails once at 40% and resumes.

Instrumentation shown in the UI records:

- startup-to-first-video-initialization elapsed time;
- input-to-next-frame latency;
- seek completion latency;
- frames over 16 ms versus total reported frames;
- peak resident memory on Dart IO platforms (`ProcessInfo.currentRss`);
- upload progress and cache-restore outcome/time.

Web cannot expose process RSS from Dart, so the UI says external capture is
required. Browser peak memory must be captured with browser tooling. Android
approval must also record `adb shell dumpsys meminfo com.fmotion.f_motion_media_spike`
while exercising the editor.

## Fixture provenance

Both fixtures are original synthetic output (solid colors, moving boxes, and
sine tones) generated for this spike and released under CC0 1.0:

```sh
ffmpeg -f lavfi -i "color=c=#6546e5:s=360x640:d=3:r=30" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -vf "drawbox=x=40+40*t:y=160:w=100:h=100:color=white@0.8:t=fill" \
  -c:v libopenh264 -b:v 300k -pix_fmt yuv420p -c:a aac -movflags +faststart \
  -shortest scene_one.mp4
ffmpeg -f lavfi -i "color=c=#10a37f:s=360x640:d=3:r=30" \
  -f lavfi -i "sine=frequency=554:duration=3" \
  -vf "drawbox=x=220-40*t:y=360:w=100:h=100:color=white@0.8:t=fill" \
  -c:v libopenh264 -b:v 300k -pix_fmt yuv420p -c:a aac -movflags +faststart \
  -shortest scene_two.mp4
```

The original VP8/WebM fixtures were replaced after a Samsung SM-F721B physical
device displayed decoder/texture corruption. The replacement MP4 scenes played
without those artifacts. That follow-up exposed a brief red Flutter error frame
while switching scenes; the controller transition now detaches the old video
before disposal, holds a neutral loading state, and rejects stale asynchronous
initializations. The transition fix still requires visual confirmation on the
phone.

## Reproduction

The implementation used Flutter 3.44.8 / Dart 3.12.2 from a temporary SDK.

```sh
flutter analyze
flutter test
flutter build web
flutter build apk --debug
```

The first three commands are expected to run without an Android SDK. The APK
command requires an Android SDK and licenses.

## Approval run still required

On one ordinary physical Android phone and one desktop Chrome/Chromium browser:

1. Record OS/browser/device model, RAM, Flutter revision, and build mode.
2. Cold-start three times and report median startup-to-initialization.
3. Perform 20 scene/crop/text interactions and report median/p95 input latency.
4. Perform 20 seeks and report median/p95 seek completion latency.
5. Play and edit for five minutes; report slow frames/total and peak memory.
6. Force the mock upload failure, verify visible progress and successful retry.
7. Save, terminate/reload, and verify the exact scene order, crop, caption, and
   audio settings restore.

Record measurements in a dated section below. Estimates must be labeled as
estimates; emulator data cannot approve Android feasibility.

## Evidence

Static evidence recorded on 2026-07-26, Fedora Linux 44
(`7.1.4-204.fc44.x86_64`), Flutter 3.44.8 revision `058e0af2c2`, Dart 3.12.2:

- `flutter analyze`: pass, no issues.
- `flutter test`: pass, 3/3 focused logic checks.
- `flutter build web`: pass, including the Wasm dry run.
- Built web output loaded in installed Brave (Chromium) headless with software
  WebGL enabled at 1440x1000 and 412x915. Both screenshots show initialized
  video, safe-area overlay, controls, and split/stacked responsive layouts.
  The UI measured startup at 887 ms and 900 ms respectively; these are headless
  smoke measurements, not ordinary-browser approval measurements.
- `flutter build apk --debug`: blocked before compilation: no Android SDK.
- `flutter doctor -v`: no Chrome executable, no Android toolchain, and no
  connected Android device (the listed Linux desktop is not an approval target).

No interactive performance series or physical-device measurements were
recorded. The headless smoke and static evidence are not claimed as browser or
Android feasibility approval.

The smoke images are `spikes/flutter_media/browser-smoke.png` and
`spikes/flutter_media/browser-mobile-smoke.png`.

Physical evidence recorded on 2026-07-26:

- The Samsung SM-F721B could open the editor and switch between both scenes.
- VP8/WebM playback showed repeated dashed artifacts and a stale green strip.
- The H.264/AAC MP4 replacements played without the WebM artifacts.
- Switching between the corrected scenes briefly showed Flutter's red error UI.
  The controller lifecycle fix passes static analysis and a stale-request
  regression check, but has not yet been visually checked on the phone.
- The upload transition regression test now proves failure at 40% and retry
  completion at 100%; the interactive flow still belongs in the approval run.
