# Plan 003: Inspect real media bytes before marking assets ready

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f13f997..HEAD -- apps/worker/src/runtime.ts apps/worker/src/index.ts apps/worker/test docs/runbooks/media-quarantine.md apps/api/src/media-storage.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-durable-local-stack.md (for integration against MinIO; unit tests can start earlier)
- **Category**: security
- **Planned at**: commit `f13f997`, 2026-07-27

## Why this matters

`docs/runbooks/media-quarantine.md` requires the worker to detect MIME,
container, dimensions, duration, and bytes. The worker currently uses only S3
`HeadObject` ContentType/ContentLength. Clients (or a malicious upload) can
declare matching metadata while storing non-media bytes, then become `ready`.

Also fix Pexels copy buffering: `apps/api/src/media-storage.ts` reads the full
`arrayBuffer()` before enforcing `maximumMediaBytes` (DoS). Fold that into this
plan as a small related trust-boundary fix.

## Current state

`apps/worker/src/runtime.ts` — `S3WorkerObjectStore.inspect`:

```ts
const result = await this.client.send(new HeadObjectCommand({ … }));
return { type: result.ContentType ?? "application/octet-stream", bytes: Number(result.ContentLength ?? 0) };
```

Inspection handler:

```ts
const detected = await store.inspect(asset.objectKey);
const accepted = inspectMedia(asset.declaredType, detected.type, detected.bytes, asset.maxBytes).accepted;
```

`apps/worker/src/index.ts` — `inspectMedia` only compares declared vs detected
type strings and size.

`docs/runbooks/media-quarantine.md`:

> The worker detects MIME, container, dimensions, duration, and bytes; client
> metadata is never promoted to authoritative media facts.

`apps/api/src/media-storage.ts` Pexels `copy`:

```ts
const bytes = new Uint8Array(await response.arrayBuffer());
if (!bytes.length || bytes.length > maximumMediaBytes) throw new Error("Pexels media rejected");
```

Allowed types today: `video/mp4`, `image/jpeg`, `image/png`
(`allowedMediaTypes` in media-storage.ts).

Toolchain: FFmpeg **8.1.2** is already a repo requirement (README). Use
`ffprobe` from that install — do not add a new media library dependency unless
ffprobe cannot read the format (STOP if so).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npm run lint` | exit 0 |
| Worker tests | `npm test --workspace apps/worker` | exit 0 |
| API tests | `npm test --workspace apps/api` | exit 0 |
| Probe available | `ffprobe -version` | prints version |

## Scope

**In scope**:
- `apps/worker/src/runtime.ts` (download/stream object + probe)
- `apps/worker/src/index.ts` (`inspectMedia` / detected shape)
- `apps/worker/test/worker.test.mjs` and/or `runtime-integration.test.mjs`
- `apps/api/src/media-storage.ts` (Pexels streaming size bound)
- `apps/api/test/media-integration.test.mjs` or a focused unit test if one exists
- `docs/runbooks/media-quarantine.md` (only if behavior details need a one-line sync)
- `plans/README.md` status

**Out of scope**:
- Feeding media into FFmpeg preview (plan 004)
- Malware scanning / ClamAV
- Changing allowed MIME set
- Beatoven / audio upload pipeline

## Git workflow

- Branch: current or `advisor/143-media-inspect`
- Commits: `fix: probe uploaded media with ffprobe`, `fix: bound Pexels download size`
- Do NOT push unless asked

## Steps

### Step 1: Extend detected media facts

Change the detected record stored on `MediaAsset.detected` to include at least:

- `type` — authoritative MIME aligned with allowed set (from probe, not client)
- `bytes` — actual object size
- `width`, `height` — integers when available
- `duration_ms` — integer for video; `0` or omit for still images

Keep JSON flexible enough for Prisma `Json` column. Update `inspectMedia` to
reject when:

- probed type ∉ allowed set or ≠ declared type
- bytes ≤ 0 or bytes > maxBytes
- video missing positive duration or dimensions
- image missing positive dimensions

**Verify**: unit tests in `apps/worker/test/worker.test.mjs` for accept/reject
tables (no network).

### Step 2: Implement real `store.inspect`

In the worker object store:

1. `HeadObject` for size ceiling — if ContentLength > maxBytes (from asset),
   quarantine without full download when possible.
2. Download object to a temp file under `os.tmpdir()` (bounded; delete in
   `finally`).
3. Run `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,codec_name -of json <file>`
   (exact args may vary — keep them in one function).
4. Map probe output → detected facts; on probe failure → quarantine.

Never log signed URLs or file contents (runbook).

**Verify**: With MinIO from plan 001 (or existing TEST_S3_ENDPOINT),
`RUN_WORKER_INTEGRATION=1` runtime test: put a small valid mp4 fixture, run
inspect → `ready`; put a text file with `Content-Type: video/mp4` →
`quarantined`.

Use the synthetic fixtures under `spikes/flutter_media/assets/fixtures/`
(CC0) if needed — copy into worker test fixtures rather than depending on
spikes at runtime if that is cleaner.

### Step 3: Bound Pexels streaming

In `PexelsClient.copy`, do **not** `arrayBuffer()` the entire body first.
Stream into a buffer or temp file while counting bytes; abort/reject when
count would exceed `maximumMediaBytes`. Then `store.put` as today.

**Verify**: unit or integration test that a response claiming huge length /
streaming past the cap rejects without allocating the full payload (mock
`fetch`/request if needed). At minimum: test a >100MB rejection path with a
mock that errors if too many bytes are read.

### Step 4: Keep e2e green

Fast demo does not exercise inspection. Ensure worker unit tests and
`npm run test:e2e:web` still pass.

**Verify**: `npm test --workspace apps/worker` && `npm run test:e2e:web`.

## Test plan

| Case | Where |
|------|--------|
| type mismatch quarantines | `worker.test.mjs` |
| oversize quarantines | same |
| valid mp4/jpeg probe accepts | integration or fixture-based |
| corrupt bytes quarantine | fixture |
| Pexels oversize aborts early | api test with mock stream |

Pattern: `apps/worker/test/worker.test.mjs`.

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm test --workspace apps/worker` exits 0 with new probe tests
- [ ] `npm test --workspace apps/api` exits 0 with Pexels bound test
- [ ] `npm run test:e2e:web` exits 0
- [ ] Worker `inspect` no longer uses **only** HeadObject ContentType as
      authoritative type (`rg -n "HeadObjectCommand" apps/worker/src/runtime.ts`
      may remain for size, but probe must run)
- [ ] No ClamAV/new media frameworks added without STOP
- [ ] `plans/README.md` 003 → DONE

## STOP conditions

- `ffprobe` cannot read H.264 mp4 / jpeg / png from the allowed set on the
  required FFmpeg 8.1.2 toolchain — report and propose options.
- Detected JSON shape change breaks Prisma reads in API without a clear
  migration — stop rather than silent dual-shape hacks across packages.
- Plan 001 stack is unavailable and integration cannot run — complete unit
  tests, mark integration BLOCKED in the plan status note, do not fake ready.

## Maintenance notes

- Plan 004 will download `ready` object keys into FFmpeg inputs; probed
  width/height/duration should be what render trusts.
- Reviewers: confirm quarantine on probe failure; never mark ready on
  HeadObject alone.
- Deferred: content-addressed malware scan; audio inspection.
