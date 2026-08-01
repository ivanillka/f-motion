# Plan 012: Make the browser journey render the actual project snapshot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 425bbd4..HEAD -- tests/e2e/run-servers.mjs tests/e2e/worker-server.mjs tests/e2e/web-flow.spec.ts apps/worker/test/fixtures/scene_one.mp4`
> If any in-scope file changed, compare the current code with the excerpts
> below. Stop on a semantic mismatch; do not overwrite newer test behavior.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `425bbd4`, 2026-08-01

## Why this matters

The shipped browser gate proves navigation and that some MP4 bytes exist, but
it does not prove the user's project reached FFmpeg. The E2E worker explicitly
renders the empty fallback, so a dark 200 ms file passes while captions, media,
scene order, and duration are disconnected. This plan establishes a truthful
characterization gate before the storyboard and preview model changes.

## Current state

- `tests/e2e/run-servers.mjs:12-24` sends only job identity and revision:

  ```js
  body: JSON.stringify({ jobId, projectId, revision: project.revision })
  ```

- `tests/e2e/worker-server.mjs:16-22` discards the snapshot deliberately:

  ```js
  await renderPreview(output, undefined, undefined, {}, {
    width: 720, height: 1280, watermark: "Reference preview"
  });
  ```

- `tests/e2e/web-flow.spec.ts:56-59` accepts any nontrivial MP4:

  ```ts
  expect(rendered.headers()["content-type"]).toContain("video/mp4");
  expect((await rendered.body()).length).toBeGreaterThan(1000);
  ```

- Reuse `apps/worker/test/fixtures/scene_one.mp4` for video assets and
  `apps/worker/test/fixtures/still.jpg` for image assets; do not add a large
  binary. Lower-level renderer tests already use these fixtures.
- Tests use Node's built-in test runner and Playwright. Match the direct,
  dependency-free style in `apps/worker/test/worker.test.mjs`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build worker | `npm run build --workspace apps/worker` | exit 0 |
| Browser E2E | `npm run test:e2e:web` | exit 0; all Playwright tests pass |
| Full typecheck | `npm run lint` | exit 0 |
| Full tests | `npm test` | exit 0 |

## Scope

**In scope**:

- `tests/e2e/run-servers.mjs`
- `tests/e2e/worker-server.mjs`
- `tests/e2e/web-flow.spec.ts`
- A small helper under `tests/e2e/` only if probing cannot stay readable in
  `web-flow.spec.ts`
- `plans/README.md` status row

**Out of scope**:

- Production API, worker, renderer, or schema changes
- New media fixtures or network calls to Pexels
- Semantic stock relevance and audio-quality policy
- Pixel-perfect OCR of burned captions; lower-level ASS tests own caption
  filter generation

## Git workflow

- Branch: `advisor/012-real-render-journey`
- Suggested commit: `test: render the browser project snapshot end to end`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Send immutable test input to the E2E worker

In `tests/e2e/run-servers.mjs`, obtain the current project snapshot in
`renders.create`. Build a test-only `mediaInputs` record for every referenced
`media_id` from the corresponding fake `mediaAssets` entry: map `video/mp4` to
the existing `scene_one.mp4` with `hasAudio: true`, and map `image/jpeg` to
`still.jpg` (the renderer supplies its silent pad), retaining each declared
type. Send `{ jobId, projectId, revision, snapshot, mediaInputs }` to the test
worker. Resolve fixture paths from `import.meta.url`; do not depend on the
shell's current directory.

Keep the test path owner-scoped through the existing `ProjectService.get` call.
Fail the request if a scene references media for which the test server has no
fixture mapping; do not silently render a color fallback.

**Verify**: `npm run test:e2e:web` → all tests pass or fail specifically on the
old fallback assumption, never on a missing relative path.

### Step 2: Render the received snapshot instead of the fallback

In `tests/e2e/worker-server.mjs`, validate that `snapshot` is an object with a
non-empty `scenes` array and that each referenced media input is within the
repository fixture directory. Convert the JSON descriptors to the
`renderPreview` media-input shape and call:

```js
await renderPreview(output, job.snapshot, undefined, mediaInputs, {
  width: 720,
  height: 1280,
  watermark: "Reference preview"
});
```

Reject malformed jobs with HTTP 400. Keep `snapshot = undefined` available
only in lower-level fixture tests; it must not appear in this server.

**Verify**:

```sh
rg -n 'renderPreview\([^,]+,\s*undefined' tests/e2e/worker-server.mjs
```

Expected: no matches. Then run `npm run test:e2e:web` → exit 0.

### Step 3: Probe the downloaded result

Add a test helper that writes the downloaded bytes to an OS temporary
directory, runs `ffprobe` with JSON output, and always removes the temporary
directory. Assert:

- video codec exists and dimensions are exactly 720×1280;
- duration is greater than 0.5 seconds and not the 0.2-second fallback;
- an AAC audio stream exists, without claiming it is audible;
- measured duration is within a small tolerance of the snapshot's total scene
  duration.

Use `spawnSync`/`execFileSync` argument arrays, never a shell-interpolated
command. Treat missing `ffprobe` as a hard test failure because the E2E worker
already requires FFmpeg tooling.

**Verify**: temporarily restore `snapshot: undefined` locally and confirm the
new duration assertion fails; restore the real snapshot and rerun
`npm run test:e2e:web` → exit 0.

### Step 4: Run repository gates

```sh
npm run lint
npm test
npm run build
npm run test:package-consumer
npm run test:e2e:web
```

Expected: every command exits 0.

## Test plan

- Real snapshot plus mapped fixture produces expected duration and dimensions.
- Empty/malformed worker job returns 400 rather than a fallback MP4.
- Missing fixture mapping fails visibly.
- Existing conflict, attribution, sign-out, and download journey still pass.

## Done criteria

- [ ] The browser-created snapshot is passed to `renderPreview`.
- [ ] `tests/e2e/worker-server.mjs` contains no undefined-snapshot render call.
- [ ] The downloaded file is probed for dimensions, duration, video, and audio
      streams.
- [ ] The test fails against the old 200 ms fallback behavior.
- [ ] All repository verification gates exit 0.
- [ ] No files outside the scope list changed, except ignored test artifacts.
- [ ] Plan 012 is marked DONE in `plans/README.md`.

## STOP conditions

- Stop if the existing fixture cannot be decoded by the production FFmpeg
  build; report the probe output instead of adding a replacement binary.
- Stop if passing the real snapshot requires changing a production interface;
  this plan is intentionally test-only.
- Stop if ffprobe duration differs because the renderer has changed since
  `425bbd4`; record the new deterministic tolerance before proceeding.
- Stop after two failed attempts at any verification step.

## Maintenance notes

- Future scene-count assertions belong here after plan 013/014 changes the
  browser journey to a multi-scene storyboard.
- This gate establishes plumbing, not visual relevance. Keep Pexels ranking
  fixtures deterministic and test them separately.
- Reviewers should reject any reintroduction of the undefined-snapshot fallback
  into browser E2E.
