# Plan 010: Bind upload size in signed PUTs and inspect Pexels like uploads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat afd8112..HEAD -- apps/api/src/media-storage.ts apps/api/src/server.ts apps/api/src/start.ts apps/web/src/main.tsx apps/api/test apps/worker/src`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/009-render-failed-atomic-outbox.md (for atomic inspect
  enqueue on the Pexels path — if 009 is not done, implement the same
  transactional enqueue pattern here rather than a racy second insert)
- **Category**: security
- **Planned at**: commit `afd8112`, 2026-07-27

## Why this matters

Two hosted media trust gaps remain after plans 003–004:

1. Presigned uploads sign `ContentType` only — clients declare `maxBytes` then
   can PUT a much larger body (up to provider limits). Quarantine happens later;
   storage abuse remains.
2. `PexelsClient.copy` inserts assets as `state: "ready"` with client/Pexels
   metadata only — no ffprobe. That bypasses the admission bar plan 003 built
   for uploads, while `assertReadySceneMedia` happily attaches those IDs.

## Current state

Signed PUT (`apps/api/src/media-storage.ts`):

```ts
signedPut(objectKey: string, contentType: string) {
  return getSignedUrl(
    this.client,
    new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: contentType }),
    { expiresIn: 300 }
  );
}
```

Admission route passes `maxBytes` into the DB but not into `signedPut`
(`apps/api/src/server.ts` uploads handler).

Pexels copy (`apps/api/src/media-storage.ts`):

```ts
const asset: StoredMedia = {
  …
  state: "ready",
  declaredType: selected.contentType,
  maxBytes: bytes.length,
  detected: { type: selected.contentType, bytes: bytes.length },
  …
};
await store.put(…);
await repository.insert(asset);
```

Upload path: `admitted` → `/complete` → `inspecting` → worker `inspectMedia` →
`ready` | `quarantined`.

Web (`apps/web/src/main.tsx`) attaches `media_id` immediately after Pexels copy
(assumes ready). Upload attach already tolerates non-ready via try/catch.

`docs/runbooks/media-quarantine.md` — worker detects MIME/container/dimensions/
duration/bytes; client metadata is never authoritative.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npm run lint` | exit 0 |
| API tests | `npm test --workspace apps/api` | exit 0 |
| Worker tests | `npm test --workspace apps/worker` | exit 0 |
| E2E | `npm run test:e2e:web` | 1 passed |

## Scope

**In scope**:
- `apps/api/src/media-storage.ts` (`signedPut`, `PexelsClient.copy`)
- `apps/api/src/server.ts` (pass `maxBytes` into sign; Pexels route response)
- `apps/api/src/start.ts` / repository (enqueue inspect for Pexels — transactional)
- `apps/web/src/main.tsx` (Pexels attach only when `ready`, or poll/status)
- API tests (`media-bound`, media-integration, auth/media routes as needed)
- `plans/README.md` status

**Out of scope**:
- Changing allowed MIME set
- ClamAV / malware scan
- Android Pexels attach UI
- Multi-scene concat

## Git workflow

- Branch: `advisor/149-media-trust-hosted` or current
- Commits: `fix: bind ContentLength on media upload signatures`,
  `fix: admit Pexels copies through worker inspection`
- Do NOT push unless asked

## Steps

### Step 1: Sign ContentLength on upload PUTs

Change `signedPut` to accept `contentLength: number` (the admitted `maxBytes`)
and pass `ContentLength: contentLength` on `PutObjectCommand` so the presigned
URL requires that exact length (S3/R2 signing behavior).

Update the uploads route to `signedPut(objectKey, declaredType, maxBytes)`.

Clients already PUT `file` with `Content-Type`; they must send a body whose
length matches the declared `bytes` used at admission (web already sends
`file.size` as `bytes` — keep that invariant).

**Verify**: unit test that `PutObjectCommand` input includes `ContentLength`
(mock S3 client or spy). Integration (if `RUN_MEDIA_INTEGRATION=1`): oversized
body against the signed URL fails. `npm test --workspace apps/api` exits 0.

### Step 2: Pexels → inspecting → worker ready

Change `PexelsClient.copy` to:

1. Bound-read bytes (already via `readBoundedBody`).
2. `store.put` as today.
3. Insert `MediaAsset` with `state: "admitted"` or `"inspecting"` (not `ready`),
   `detected` omitted or unset until the worker writes it.
4. Enqueue `inspect-media` **in the same transaction** as the state write
   (reuse plan 009 helper). If inserting as `admitted`, also
   `markInspecting` in that transaction before outbox insert.

Return the asset (state `inspecting`) to the client.

**Verify**: API test — after copy, state is not `ready`; outbox row exists.
Worker inspect of a real fixture (or integration) promotes to `ready` with
width/height/duration facts. Quarantine path still works for corrupt bytes.

### Step 3: Web attach after ready

Update `copyPexels` in `apps/web/src/main.tsx`:

- Do **not** `update_scene` with `media_id` while state is `inspecting`.
- Set status to “Pexels media queued for inspection.”
- Smallest UX: poll a minimal GET if one exists, **or** add
  `GET /api/projects/:projectId/media/:assetId` returning `{ id, state }`
  (owner-scoped) and poll a few times, then attach when `ready`.
- If you add GET, keep it tiny — no listing browser.

Upload path can keep today’s try/attach or share the same poll helper.

**Verify**: `npm run test:e2e:web` still passes (e2e does not need Pexels).
Manual or API test covers attach-after-ready.

### Step 4: Regression gates

```sh
npm run lint
npm test
npm run test:e2e:web
```

## Test plan

| Case | Where |
|------|--------|
| signedPut includes ContentLength | api test |
| Pexels insert not ready | api test |
| Pexels + inspect → ready with probe facts | worker/api integration when flags on |
| assertReadySceneMedia rejects inspecting id | existing media_id tests |
| e2e unchanged | playwright |

## Done criteria

- [ ] Upload signatures bind length to admitted `maxBytes`
- [ ] Pexels assets become `ready` only after worker `inspectMedia` accepts
- [ ] Web does not attach non-ready Pexels `media_id`
- [ ] Lint / unit / e2e green
- [ ] `plans/README.md` 010 → DONE

## STOP conditions

- Target object store rejects `ContentLength` in presign (provider quirk) —
  stop and report; do not remove size binding without an equivalent
  HeadObject-on-complete hard check.
- Pexels must stay instantly attachable for a demo stakeholder — stop and
  report rather than re-introducing unprobed `ready`.

## Maintenance notes

- Reviewers: quarantine runbook remains authoritative; Pexels attribution
  fields still persist on the asset.
- Follow-up: notify channel instead of poll; Android attach parity.
- Depends on worker + outbox being healthy (plans 008–009) for hosted demos.
