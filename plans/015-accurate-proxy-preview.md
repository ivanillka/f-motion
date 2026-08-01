# Plan 015: Add an accurate in-app proxy preview before final rendering

> **Executor instructions**: Follow this plan step by step. Run each
> verification command and confirm its expected result. Stop rather than
> improvising when a STOP condition occurs. Update `plans/README.md` on
> completion unless a reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 425bbd4..HEAD -- prisma/schema.prisma prisma/migrations apps/api/src/render-repository.ts apps/api/src/server.ts apps/worker/src apps/web/src apps/api/test apps/worker/test tests/e2e docs/contracts docs/runbooks`
> Plans 012–014 are expected to change tests, contracts, and web scene handling.
> Stop if their completed interfaces do not match this plan's assumptions.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/012-real-render-journey.md`,
  `plans/013-multi-scene-storyboard-contract.md`,
  `plans/014-focused-storyboard-editor.md`
- **Category**: direction / architecture
- **Planned at**: commit `425bbd4`, 2026-08-01

## Why this matters

The current screen calls a thumbnail-plus-caption an approximate preview, then
uses the only render job as a "Final render." Users cannot watch timing, crop,
motion, captions, scene order, or audio before committing to final output. This
plan separates a fast, accurate proxy from final delivery while preserving one
deterministic FFmpeg implementation.

## Current state

- `apps/web/src/main.tsx:530-537` renders a still image and caption, not video.
- `apps/web/src/main.tsx:440-445` posts the only render endpoint and immediately
  changes to the final screen.
- `apps/worker/src/queue.ts:4-18` already names the queue/job
  `render-preview`/`PreviewJob`.
- `prisma/schema.prisma:115-147` has one `RenderJob`/`RenderResult` shape with no
  render kind or snapshotted profile.
- `prisma/migrations/20260801000000_coalesce_render_jobs/migration.sql:45-47`
  permits one queued/running/complete job per owner/project/revision. Preview
  and final cannot coexist under this index.
- `apps/worker/src/runtime.ts:99-108` reads one process-wide profile; result
  metadata at lines 518-524 records configured dimensions, not measured output.
- `apps/api/src/render-repository.ts:294-303` already reports `stale` when the
  result revision differs from the current project. Reuse this truth.
- Host policy owns render profiles (`docs/contracts/host-integration.md:1-28`).
  Clients must never supply arbitrary FFmpeg dimensions or watermark text.

## Target model

Introduce `RenderKind = "preview" | "final"` and snapshot these server-selected
values into every job:

- `kind`
- validated `renderProfile` JSON (`width`, `height`, optional watermark)
- immutable project snapshot (already `renderInput`)

Preview defaults: 540×960 and host-configured preview watermark. Final uses the
existing validated `RENDER_WIDTH`, `RENDER_HEIGHT`, and `RENDER_WATERMARK`.
Preview configuration may use `PREVIEW_RENDER_WIDTH`,
`PREVIEW_RENDER_HEIGHT`, and `PREVIEW_RENDER_WATERMARK`, validated at API
startup. Move profile selection to the admitting API: the worker validates and
uses the profile stored on the job and no longer chooses a process-global
profile from its own environment. Do not let the browser send profile values.

The API render request accepts only `{ kind: "preview" | "final" }`. Plan 015
exposes both backend kinds but the web requests preview only; plan 016 adds the
final approval path.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Prisma | `DATABASE_URL="$TEST_DATABASE_URL" npx prisma validate` | schema valid when the documented test database URL is set |
| API tests | `npm test --workspace apps/api` | exit 0 |
| Worker tests | `npm test --workspace apps/worker` | exit 0 |
| Web tests | `npm test --workspace apps/web` | exit 0 |
| E2E | `npm run test:e2e:web` | exit 0 |
| Full gates | `npm run lint && npm test && npm run build` | exit 0 |

## Scope

**In scope**:

- `prisma/schema.prisma`
- One new forward-only migration under `prisma/migrations/`
- `apps/api/src/render-repository.ts`, `apps/api/src/server.ts`, and
  `apps/api/src/start.ts` for trusted profile construction
- `apps/api/test/render-persistence.test.mjs` and route tests
- `apps/worker/src/queue.ts`, `apps/worker/src/runtime.ts`, `apps/worker/src/start.ts`
- Worker unit/integration tests
- `apps/web/src/main.tsx`, `apps/web/src/api.ts`, `apps/web/src/style.css`, web tests
- `tests/e2e/*`
- `.env.example`, `fly.api.toml`, `fly.worker.toml`, host contract/runbook docs
- `plans/README.md` status

**Out of scope**:

- Final approval/download UX (plan 016)
- Editor bundles or timeline XML (plan 017)
- Different rendering implementation for preview versus final
- Client-selected arbitrary profiles
- GPU rendering, adaptive bitrate streaming, HLS, or a video CDN
- Full audio-content policy; record measured facts without inventing audio

## Git workflow

- Branch: `advisor/015-accurate-proxy-preview`
- Suggested commits:
  - `feat: snapshot preview and final render kinds`
  - `feat: play accurate proxy previews in app`
  - `test: verify preview profile and stale revisions`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Migrate jobs to render kind and snapshotted profile

Add a Prisma enum or constrained text representation for `preview` and `final`,
a non-null `kind` defaulting/backfilled to `preview`, and a non-null
`renderProfile` JSON column. The rollout must drain active work first. Write a
forward-only SQL migration that:

1. fails closed when any historical job is still `queued` or `running`;
2. adds/backfills the fields for historical rows;
3. derives completed-job width/height from its existing `RenderResult.metadata`
   and aborts if those measured/configured facts are missing or malformed;
4. uses a documented neutral placeholder profile only for cancelled/failed
   jobs that can never render, rather than pretending it describes an output;
5. replaces `RenderJob_canonical_revision_key` with uniqueness over
   `(ownerId, projectId, revision, kind)` for active/canonical states;
6. preserves historical jobs/results/events.

Do not rewrite old migrations. Update every integration-test migration list.

**Verify**: `npx prisma validate` exits 0. With `TEST_DATABASE_URL`, apply all
migrations to an empty schema and run `npm test --workspace apps/api` → exit 0.

### Step 2: Select and snapshot trusted profiles at admission

Create a small API profile-construction function using the engine's existing
validation. The API/repository must map `kind` to a host-owned profile and save
that exact profile with the job. Remove worker-side environment selection once
the persisted profile path is live; on every attempt the worker validates the
stored profile again before constructing FFmpeg arguments. Extend canonical coalescing so repeated preview
requests for an unchanged revision return the same active/completed preview;
final is independently canonical.

Return typed 422 for unknown/malformed kind. The request body must not accept
width, height, watermark, codec, bitrate, or FFmpeg arguments.

Include `kind` in the outbox payload for diagnostics, but the worker must read
and validate authoritative `kind`, `renderProfile`, and `renderInput` from the
database before media work.

**Verify**: API tests prove preview/final coexist, duplicate preview coalesces,
and client profile injection is ignored or rejected.

### Step 3: Render with the job's immutable profile and probe the result

Replace the process-global profile passed to every job with the validated
profile stored on that job. Keep one `renderPreview`/FFmpeg path for both kinds.
After FFmpeg succeeds and before upload, use bounded `ffprobe` execution to
measure and validate:

- width and height equal the snapshotted profile;
- duration is positive and within tolerance of total scene duration;
- video codec and pixel format are present;
- audio stream presence, codec, channel count, and peak/RMS when measurable;
- scene count and project revision copied from immutable input.

Persist measured facts plus `kind` and profile in `RenderResult.metadata`. A
dimension/duration mismatch fails the job; silence is metadata, not an
unconditional failure.

Reuse the bounded child-process patterns already used for media probing in
`apps/worker/src/runtime.ts`; never shell-interpolate paths.

**Verify**: worker unit/integration tests cover both profiles, wrong measured
dimensions, silence metadata, cancellation, and cleanup. Run
`npm test --workspace apps/worker` → exit 0.

### Step 4: Expose playback truth through the API

Extend the completed-result response to include:

```json
{
  "url": "short-lived signed URL",
  "expires_at": "ISO timestamp",
  "kind": "preview",
  "stale": false,
  "metadata": { "width": 540, "height": 960, "duration_ms": 12000 }
}
```

Whitelist response metadata fields; do not blindly return arbitrary JSON.
Continue owner-scoped lookup. Keep signed URLs short-lived and provide a method
to refresh them when the player is reopened or receives an expiry error.

**Verify**: route tests prove owner scoping, metadata allowlisting, kind, stale
truth, and URL expiry.

### Step 5: Add the accurate proxy preview player

In the web editor, retain the instantaneous composition preview but label it
"Approximate." Add `Generate accurate preview`. Follow SSE using the existing
reconnect logic; on completion render a native:

```html
<video controls playsinline preload="metadata">
```

using the signed result URL. Show measured duration/resolution and explicit
audio status. Provide `Edit storyboard` and a disabled/placeholder-free path
for final approval; plan 016 adds final actions, so do not ship a dead button.

If any edit increments project revision, immediately mark the current player
"Older preview — regenerate" and disable approval. Refresh an expired signed
URL through the authenticated API before playback instead of storing it in
local storage.

Implement keyboard-accessible controls and a text fallback for browsers that
cannot play the MP4.

**Verify**: web tests cover complete, failed, cancelled, expired URL refresh,
stale after edit, and no autoplay. E2E watches metadata load from the real
plan-012 result.

### Step 6: Document and run operational gates

Update `.env.example`, Fly worker configuration, host contract, and render
runbook with preview/final profile ownership and migration rollout. Preserve
the pause/drain/migrate/deploy order from `docs/runbooks/render-worker.md`.

Run:

```sh
npm run lint
npm test
npm run build
npm run test:package-consumer
npm run test:e2e:web
npx prisma validate
flutter analyze apps/mobile
cd apps/mobile && flutter test
```

Expected: every command exits 0.

## Test plan

- Migration preserves historical jobs as preview and updates uniqueness.
- Preview and final canonical jobs coexist for one revision.
- Client cannot select dimensions/watermark.
- Worker uses the job profile, not current process values.
- Probe rejects wrong dimensions/duration and records silence without failing.
- API returns allowlisted measured metadata and authoritative stale state.
- Player loads accurate proxy, refreshes an expired URL, and becomes stale on
  edit.
- E2E verifies multi-scene total duration at proxy dimensions.

## Done criteria

- [ ] Render jobs persist kind and immutable trusted profile.
- [ ] Preview/final jobs can coexist without weakening coalescing.
- [ ] The worker probes output before upload and records measured facts.
- [ ] The web plays a real accurate proxy before final rendering.
- [ ] Editing a project invalidates approval of an older preview.
- [ ] No client-controlled FFmpeg profile reaches the worker.
- [ ] Migration and all repository gates exit 0.
- [ ] Only in-scope files changed.
- [ ] Plan 015 is marked DONE in `plans/README.md`.

## STOP conditions

- Stop if plan 012's real render E2E is not green before migration work.
- Stop if the migration would delete or arbitrarily choose among completed
  historical results.
- Stop if API and worker cannot share identical profile validation without
  moving host environment access into the neutral engine.
- Stop if browser playback requires making the R2 bucket public.
- Stop if proxy rendering diverges into a second composition implementation.
- Stop after two failed verification attempts.

## Maintenance notes

- Preview and final are artifact policy; deterministic composition remains one
  engine path.
- When adding a new artifact kind, update canonical uniqueness, admission,
  worker validation, result metadata, and UI labels together.
- Reviewers should compare measured output facts with configured profile rather
  than trusting configuration metadata.
