# Plan 004: Connect admitted media into the FFmpeg preview render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f13f997..HEAD -- apps/worker/src/index.ts apps/worker/src/runtime.ts apps/api/src/domain.ts apps/api/src/server.ts packages/reel-engine/src/index.ts packages/contracts/src/index.ts apps/web/src/main.tsx apps/worker/test`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans/002-validate-command-envelopes.md, plans/003-real-media-inspection.md
- **Category**: direction / architecture
- **Planned at**: commit `f13f997`, 2026-07-27

## Why this matters

Gate 2 (architecture drawio) requires Pexels media → edit → server-rendered
preview → download. Today uploads and Pexels copy create `MediaAsset` rows, but
`ffmpegArguments` always uses a generated `color=` lavfi input. Previews ignore
user media. `media_id` on scenes is optional and never ownership-checked.

Until this lands, the product is a caption renderer, not a video editor.

## Current state

`apps/worker/src/index.ts` — `ffmpegArguments`:

```ts
return [
  "-y",
  "-f", "lavfi",
  "-i", `color=c=#202027:s=${plan.width}x${plan.height}:d=${duration}:r=30`,
  "-vf", filters.join(","),
  …
];
```

`packages/contracts/src/index.ts` — `Scene.media_id?: string`.

`apps/api/src/domain.ts` — `update_scene` persists `command.payload.scene` JSON
without checking media readiness/ownership.

`apps/web/src/main.tsx` — Pexels/upload success only sets a status string; it
does **not** call `update_scene` with `media_id`.

Architecture Gate 2: sign-in → brief → three concepts → Pexels media → scene
reorder/text edit → server preview → download. No FAL/payments/music.

Design: dark Fotium shell already partially applied; keep changes functional.
AGENTS.md: smallest path — one scene with attached media is enough for v1 of
this plan; multi-scene concat can be a follow-up if `select_concept` still
creates a single scene.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | exit 0 |
| Worker tests | `npm test --workspace apps/worker` | exit 0 |
| E2E | `npm run test:e2e:web` | 1 passed (update if flow gains media attach) |

## Scope

**In scope**:
- `apps/worker/src/index.ts` — build FFmpeg args from scene media files
- `apps/worker/src/runtime.ts` — download ready media objects for the job;
  pass local paths into render
- `apps/api/src/domain.ts` / command path — reject `media_id` unless asset is
  owner-scoped, same `projectId`, and `state === "ready"`
- `packages/reel-engine/src/index.ts` — keep shape bounds; ownership stays in API
- `apps/web/src/main.tsx` — after successful upload complete or Pexels copy,
  `update_scene` with `media_id` on the current scene (minimal UI)
- Tests under `apps/worker/test`, `apps/api/test`, optionally adjust e2e
- `plans/README.md` status

**Out of scope**:
- Full Stitch storyboard chrome / drafts library
- Focal-point crop mathematics beyond simple `scale`/`crop` that fits 720×1280
- Audio tracks / music
- Android parity (direction follow-up)
- Changing immutable render object key scheme

## Git workflow

- Branch: current or `advisor/144-media-in-preview`
- Commits: `feat: render admitted scene media in preview`,
  `feat: attach media_id from web editor`
- Do NOT push unless asked

## Steps

### Step 1: Enforce media_id at the API command boundary

When applying `update_scene` (Postgres path and in-memory `ProjectService` if it
persists scenes the same way):

- If `scene.media_id` is absent/undefined — allowed (color fallback OK for now).
- If present — load media by `(ownerId, projectId, media_id)`; require
  `state === "ready"`; else throw validation/conflict error → HTTP 422.

Add API/domain tests for foreign id, wrong project, quarantined, and ready.

**Verify**: `npm test --workspace apps/api` includes the new cases.

### Step 2: Worker downloads media and renders it

In `runtime.ts` `render` handler, before `renderPreview`:

1. For each scene with `media_id`, load `MediaAsset` where owner/project/id match
   and state is `ready`.
2. Download `objectKey` to the job temp directory.
3. Pass a map `media_id → local path` into `renderPreview` / `ffmpegArguments`.

In `ffmpegArguments` (ponytail ceiling: **single scene / first scene with
media** is enough if multi-scene concat is large):

- If a local media path exists: use it as `-i`, scale/crop to 720×1280, trim to
  `duration_ms`, overlay caption + watermark as today.
- If no media: keep current lavfi color fallback so e2e without media still works.

Prefer still images (`image/jpeg`, `image/png`) and `video/mp4` only — match
allowed types. Use `ffprobe`/detected type from asset when choosing input args.

**Verify**: Worker unit test builds args containing the media input path (not
only `color=`). Integration or local test: put fixture mp4 in store, attach
media_id, render, output mp4 > 1KB with `ftyp`.

### Step 3: Wire web attach

In `apps/web/src/main.tsx`, after upload complete or Pexels copy returns an
asset id:

- Call `api.command(…, "update_scene", { scene: { …scene, media_id } })`.
- Show save status as today.

Do not build a media browser UI beyond existing buttons.

**Verify**: Manual or e2e: if e2e stays media-less, keep it green; add a worker
test that proves media path. Optional Playwright extension only if fixtures are
easy — do not block on browser upload flakiness.

### Step 4: Regression gates

**Verify**:

```sh
npm run lint
npm test
npm run test:e2e:web
```

All exit 0.

## Test plan

| Case | Where |
|------|--------|
| ready media_id accepted | api test |
| quarantined/foreign media_id rejected | api test |
| ffmpeg args include media input when path provided | worker.test.mjs |
| fallback color path still renders | existing worker render test |
| caption/watermark still present | worker.test.mjs |

## Done criteria

- [ ] `npm run lint` / `npm test` / `npm run test:e2e:web` exit 0
- [ ] A render with an attached ready mp4 (fixture) produces a preview whose
      FFmpeg inputs include that file (test assertion on args and/or output)
- [ ] `media_id` for non-ready assets cannot persist via command API
- [ ] Web attaches `media_id` after Pexels or upload success
- [ ] No payments/FAL/music code introduced
- [ ] `plans/README.md` 004 → DONE

## STOP conditions

- Multi-scene timeline concat is required for Gate 2 acceptance **and** exceeds
  a one-day FFmpeg graph — implement single-scene media first, then STOP and
  report before inventing an editor rewrite.
- Focal/crop must match client storyboard exactly — out of scope; use simple
  cover-crop; STOP if product owner rejects cover-crop.
- Plans 002/003 not DONE — do not start.
- Hardware cannot run FFmpeg with mp4 decode — report environment gap.

## Maintenance notes

- Reviewers: trust boundary (ready+owned only); temp files always deleted;
  immutable render key unchanged.
- Follow-ups: multi-scene concat, focal-point parity, Android attach UI,
  revision-frozen media snapshots (CORRECTNESS-01 deferred).
- Approximate client preview remains approximate; server render stays source of
  truth (`docs/contracts/client-boundary.md`).
