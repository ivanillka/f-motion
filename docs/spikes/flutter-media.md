# Flutter media feasibility spike

Status: **STOPPED pending stronger Purple Y-fixture confirmation and an
interactive desktop-browser approval run**. A Samsung SM-F721B profile run
passed the recorded Android thresholds with the prior Purple fixture. The
replacement fixture deliberately increases vertical travel and must still be
visually confirmed on that phone. Headless browser smoke evidence is not an
interactive desktop approval.

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

- startup-to-first-successful-video-initialization elapsed time, recorded once
  and retained across later scene switches;
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
ffmpeg -f lavfi -i "color=c=#ef4444:s=360x360:d=3:r=30" \
  -f lavfi -i "color=c=#6546e5:s=360x560:d=3:r=30" \
  -f lavfi -i "color=c=#2563eb:s=360x360:d=3:r=30" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -filter_complex \
  "[0:v][1:v][2:v]vstack=inputs=3,drawbox=x=120:y=40+360*t:w=120:h=120:color=white@0.9:t=fill[v]" \
  -map "[v]" -map 3:a -c:v libopenh264 -b:v 600k -pix_fmt yuv420p \
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

`scene_one.mp4` is a 360x1280 portrait fixture with unmistakable red top,
purple center, and blue bottom landmarks plus a vertically moving white box.
Its even dimensions and YUV 4:2:0 pixel format are codec-safe. `BoxFit.cover`
crops it into the 9:16 preview, so moving focal Y from -1 through 0 to 1
materially selects the top, center, and bottom region. This taller replacement
increases travel without adding editor zoom behavior. Focal X correctly has no
visible range for this narrower-than-9:16 fixture. `scene_two.mp4` is a 960x540
landscape fixture with red, green, and blue horizontal landmarks. Moving focal
X from -1 through 0 to 1 visibly selects its left, center, and right region,
while focal Y correctly has no visible range. Together the fixtures prove both
focal axes without introducing production crop/zoom behavior.

Fixture SHA-256:

- `scene_one.mp4`: `efd8861dd0b91c156db8e407901ae282b752b289fd1fa17882828647873c09ff`
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

Physical profile evidence recorded on 2026-07-26 on a Samsung SM-F721B:

- Android activity cold launches were 558 ms, 527 ms, and 511 ms; median
  527 ms, passing the 3-second threshold.
- The initial app overlay reported 393 ms from process start to the first
  successful video initialization. A later scene switch incorrectly replaced
  that value with 207761 ms. The instrumentation now retains the first value,
  and a focused regression check covers that rule; the corrected display still
  requires confirmation on the next phone run.
- Across 20 measured interactions, input latency median was 6.8 ms and p95 was
  11.6 ms, passing the 100 ms p95 threshold.
- Across 20 completed seeks, seek latency median was 1.7 ms and p95 was 3.7 ms,
  passing the 250 ms p95 threshold.
- The five-minute editing run recorded 53 slow frames out of 5991 (0.88%),
  passing the 5% threshold.
- Peak overlay RSS was 235.3 MB. `dumpsys meminfo` recorded PSS 228263 KB and
  RSS 315496 KB, passing the 500 MB PSS threshold.
- The H.264/AAC scenes played cleanly after VP8/WebM had produced decoder
  artifacts. Rapid switching was visually clean after the controller lifecycle
  fix, with no later red screens or crashes.
- Green Focal X and the prior 360x800 Purple Focal Y fixture both worked on the
  device. The user found Purple Y travel too gentle. The new 360x1280 Purple
  fixture is codec-verified and intentionally stronger, but its visual behavior
  remains pending Samsung confirmation.
- The user confirmed the mock upload visibly failed at 40%, retried to
  completion, and the saved caption, selected scene, and focal values restored
  after terminating and reopening the app.

This Android evidence does not approve the whole spike. The stronger Purple
fixture and corrected frozen startup display need a brief repeat device check,
and the ordinary interactive desktop-browser run remains outstanding.

Final-correction verification on 2026-07-26:

- `ffprobe`: Purple video is H.264 Baseline, 360x1280, YUV420P, 3.000 seconds;
  audio is AAC-LC, 44.1 kHz mono, 3.000 seconds.
- `flutter analyze`: pass, no issues.
- `flutter test`: pass, 11/11 checks.
- `flutter build web`: pass, including the Wasm dry run.
- `flutter build apk --profile`: pass; output APK is 86.8 MB.

Ordinary desktop-browser evidence recorded on 2026-07-26 in a dedicated,
non-headless Brave profile:

- Startup was 447 ms.
- Across 20 inputs, median latency was 10.5 ms and p95 was 12.3 ms.
- Across 20 real pointer seek clicks, median latency was 0.2 ms and p95 was
  0.3 ms.
- Draft restoration took 30 ms. Playback, scene switching, focal crop, upload
  failure/retry, and restoration interactions passed.
- JavaScript heap was 28,061,616 bytes used out of 42,369,024 bytes total.
  Main Brave process RSS was 339,768 KB.
- The run recorded 66 slow frames out of 856 (7.7%), failing the below-5%
  threshold. Investigation found the measurement callback rebuilt the editor
  for every frame-timing batch, so its observer overhead could contaminate the
  result.

The instrumentation now counts every frame without rebuilding on every timing
callback, coalesces overlay refreshes to at most one per 400 ms, and resets the
frame counters once after the first successful media initialization. It does
not reset on later scene switches or discard slow frames. A new five-minute
ordinary Brave run is pending; desktop feasibility is not yet claimed as PASS.

REVISE verification:

- `flutter analyze`: pass, no issues.
- `flutter test`: pass, 14/14 checks, including exact frame accumulation,
  one-time steady-state reset, and refresh coalescing.
- `flutter build web`: pass, including the Wasm dry run.
- `flutter build apk --profile`: pass; output APK is 86.8 MB.
