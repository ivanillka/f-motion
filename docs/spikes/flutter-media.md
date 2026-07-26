# Flutter media feasibility spike

Status: **STOPPED pending repeat physical-device validation and complete
measurements**. The initial static run had no `adb`, Android SDK,
Chrome/Chromium, or connected Android device. A later Samsung SM-F721B run
exposed the fixture issue documented below; no Android or browser feasibility
result is inferred yet.

## Scope proven in code

The spike has locally bundled portrait and landscape H.264 MP4 scenes and
implements playback, pause, seek, scene switching and reorder, focal-point crop
controls, an
80-character overlay inside visible safe-area bounds, approximate embedded-audio
volume/ducking, a responsive split/stacked editor, persisted draft restore, and
a mock signed upload that deliberately fails once at 40% and resumes.
At a 320 px viewport, the caption is deterministically checked to remain inside
the visible overlay safe area without a layout exception. When the platform
requests reduced motion, scene looping is disabled and any playing scene is
paused when the preference changes. Playback remains available through the
explicit Play control and runs once rather than looping.

Instrumentation shown in the UI records:

- startup-to-first-video-initialization elapsed time;
- input-to-next-frame latency over the latest 20 measured interactions;
- seek completion latency over the latest 20 completed seeks;
- frames over 16 ms versus total reported frames;
- peak resident memory on Dart IO platforms (`ProcessInfo.currentRss`);
- upload progress and cache-restore outcome/time.

Input and seek samples are held in memory only and are not persisted. The
overlay reports the bounded sample count, median, and p95 in milliseconds.
Median is the middle sorted value for odd counts and the truncated arithmetic
mean of the two middle values for even counts. P95 uses nearest rank:
`ceil(0.95 * sample count)`. Each input's next-frame callback and each completed
seek adds exactly one sample; after 20, the oldest sample is discarded.

Web cannot expose process RSS from Dart, so the UI says external capture is
required. Browser peak memory must be captured with browser tooling. Android
approval must also record `adb shell dumpsys meminfo com.fmotion.f_motion_media_spike`
while exercising the editor.

## Fixture provenance

Both fixtures are original synthetic output (solid colors, moving boxes, and
sine tones) generated for this spike and released under CC0 1.0:

```sh
ffmpeg -f lavfi -i "color=c=#ef4444:s=360x120:d=3:r=30" \
  -f lavfi -i "color=c=#6546e5:s=360x560:d=3:r=30" \
  -f lavfi -i "color=c=#2563eb:s=360x120:d=3:r=30" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -filter_complex \
  "[0:v][1:v][2:v]vstack=inputs=3,drawbox=x=130:y=20+220*t:w=100:h=100:color=white@0.9:t=fill[v]" \
  -map "[v]" -map 3:a -c:v libopenh264 -b:v 400k -pix_fmt yuv420p \
  -c:a aac -movflags +faststart -shortest scene_one.mp4
ffmpeg -f lavfi -i "color=c=#ef4444:s=320x540:d=3:r=30" \
  -f lavfi -i "color=c=#10a37f:s=320x540:d=3:r=30" \
  -f lavfi -i "color=c=#2563eb:s=320x540:d=3:r=30" \
  -f lavfi -i "sine=frequency=554:duration=3" \
  -filter_complex \
  "[0:v][1:v][2:v]hstack=inputs=3,drawbox=x=80+240*t:y=210:w=120:h=120:color=white@0.9:t=fill[v]" \
  -map "[v]" -map 3:a -c:v libopenh264 -b:v 900k -pix_fmt yuv420p \
  -c:a aac -movflags +faststart -shortest scene_two.mp4
```

`scene_one.mp4` is a 360x800 portrait fixture with red top, purple center, and
blue bottom landmarks plus a vertically moving white box. `BoxFit.cover` crops
it into the 9:16 preview, so moving focal Y from -1 through 0 to 1 visibly
selects the top, center, and bottom region. Focal X correctly has no visible
range for this narrower-than-9:16 fixture. `scene_two.mp4` is a 960x540
landscape fixture with red, green, and blue horizontal landmarks. Moving focal
X from -1 through 0 to 1 visibly selects its left, center, and right region,
while focal Y correctly has no visible range. Together the fixtures prove both
focal axes without introducing production crop/zoom behavior.

Fixture SHA-256:

- `scene_one.mp4`: `9d1b157e114c5623f3c06398d6d5a5d593c6b6bc64dac7be7a5f83010d012b1b`
- `scene_two.mp4`: `b3cd3803415498614b5b820ce3f98bba35935dcb8d3bd835072a95661096f429`

The original VP8/WebM fixtures were replaced after a Samsung SM-F721B physical
device displayed decoder/texture corruption. The replacement MP4 scenes played
without those artifacts. That follow-up exposed a brief red Flutter error frame
while switching scenes; the controller transition now detaches the old video
before disposal, holds a neutral loading state, and rejects stale asynchronous
initializations. The transition fix was visually confirmed on that phone.

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

Performance approval must use a profile build. Debug startup, frame, latency,
and memory readings are diagnostic only and cannot approve feasibility.

Approved feasibility thresholds:

- cold startup median across three launches: at most 3 seconds;
- input latency p95 across 20 interactions: at most 100 ms;
- seek completion latency p95 across 20 seeks: at most 250 ms;
- slow frames during the five-minute editing run: below 5%;
- peak Android PSS: at most 500 MB;
- zero crashes, Flutter red screens, lost drafts, or broken upload retries.

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
- The overlay now retains bounded 20-sample input and seek windows and reports
  deterministic median/p95 values. The updated profile APK builds successfully;
  installation and the final physical 20-action/20-seek run remain pending.
