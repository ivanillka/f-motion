# Web-native media feasibility spike

Status: **PASS — split React web / Flutter Android boundary approved**

## Scope and provenance

This disposable React 19.1 / TypeScript 5.8 / Vite 6.4 spike uses native
`<video>`, CSS `object-fit: cover` / `object-position`, React state, and
`localStorage`. It has no router, state library, UI framework, animation
library, test framework, media wrapper, canvas, server, or network API.

The two fixtures are the synthetic CC0 1.0 H.264/AAC files established by Plan
134 and served directly from its fixture directory:

- `scene_one.mp4` (purple, vertical focal Y):
  `efd8861dd0b91c156db8e407901ae282b752b289fd1fa17882828647873c09ff`
- `scene_two.mp4` (green, horizontal focal X):
  `b3cd3803415498614b5b820ce3f98bba35935dcb8d3bd835072a95661096f429`

Both played and sought without artifacts. Switching between their stable IDs
made the Purple Y and Green X focal behavior visibly distinct.

## Measurement method

Evidence was recorded on 2026-07-26 on Fedora Linux
`7.1.4-204.fc44.x86_64` with Brave `150.1.92.143` in a dedicated,
non-headless profile running the Vite production output. DevTools Protocol
confirmed exactly one target at `http://127.0.0.1:4173/` and
`document.visibilityState === "visible"`. The window remained visible and
unoccluded for each five-minute run.

The accepted run performed three cache-cleared reloads, 20 measured focal
inputs, 20 completed native-video seeks, four stable-ID scene reorders,
ordinary playback, mock upload failure at exactly 40% and retry to exactly
100%, and a fail-hard draft reload/restore assertion. The restored snapshot was
`selected: green`, `order: [green, purple]`, caption
`Draft restore proves every editor value.`, `focalX: 0.75`, `focalY: -0.6`,
`volume: 0.35`, and `ducking: false`. Raw latency samples use bounded 20-entry
mutable buffers; diagnostics refresh no more than every 400ms.

Before the five-minute count, 120 idle `requestAnimationFrame` intervals
calibrated a 16.70ms median cadence. The slow-frame definition was frozen before
the run at `max(20ms, 1.5 × cadence median)` = 25.05ms.

Screenshots from the accepted build are retained locally under the ignored
`spikes/web_media/measurements/` directory:

- `desktop-1440.png`
- `mobile-320.png`
- `mobile-320-max-caption.png`

`file measurements/mobile-320-max-caption.png` confirmed the maximum-caption
artifact is exactly 320×900 pixels (DSF 1). Manual inspection confirmed the
desktop split layout, the true 320px stacked layout, the maximum caption inside
the video safe area above native controls, and no horizontal overflow.

## Accepted results

| Gate | Measurement | Threshold | Result |
| --- | --- | --- | --- |
| Cold startup | 107.0 / 82.4 / 84.6ms; median **84.6ms** | ≤ 3,000ms | PASS |
| Input latency | n=20; median **8.2ms**, p95 **15.6ms** | p95 ≤ 100ms | PASS |
| Seek completion | n=20; median **16.1ms**, p95 **33.2ms** | p95 ≤ 250ms | PASS |
| Slow frames | **0 / 17,888 (0%)** over five minutes | < 5% | PASS |
| Reliability | no crash/error screen; all seven distinct draft fields restored exactly; upload 40% failure then 100% retry | zero failures | PASS |

CDP reported JavaScript heap usage of 2,504,932 bytes used out of 3,670,016
bytes total (embedder heap 5,487,248 bytes). External process sampling reported
1,289,724KB aggregate RSS for the dedicated profile and 350,376KB for its
largest process. Memory is diagnostic; Plan 139 sets no browser memory
threshold.

## Discarded runs

Two earlier visible five-minute runs passed the numeric performance thresholds
but are excluded from approval:

1. The first lacked a viewport declaration, so its nominal 320px capture scaled
   the desktop layout instead of proving the required responsive stack.
2. The second proved the stack, but maximum-caption inspection found the
   overlay too close to native video controls.

The accepted run followed the bounded viewport and safe-area corrections and
measured the exact final production build. No threshold was changed.

## Static verification

`npm ci`, `npm run typecheck`, all 9 Node tests, and `npm run build` pass. Tests
cover bounded eviction; empty/odd/even median; nearest-rank p95; cadence
threshold calculation; stable reorder; focal clamping; draft validation and
fallback; upload failure/retry endpoints; and reduced-motion loop behavior.

## Decision

**PASS — split React web / Flutter Android boundary approved**

An advisor must replace stale Plan 135 with a production vertical-slice plan
using:

```text
apps/web/              React + TypeScript
apps/mobile/           Flutter Android
apps/api/              Express + TypeScript
apps/worker/           TypeScript FFmpeg worker
packages/contracts/    language-neutral OpenAPI/JSON Schema
packages/reel-engine/  server/worker-only private TypeScript
```

This spike does not scaffold those directories. Production remains gated on
that replacement plan.
