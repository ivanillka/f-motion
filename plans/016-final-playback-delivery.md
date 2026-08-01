# Plan 016: Gate final rendering on an approved preview and deliver it in-app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result. Stop on any condition
> in "STOP conditions" and report instead of improvising. Update
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 425bbd4..HEAD -- apps/api/src/server.ts apps/api/src/render-repository.ts apps/api/src/media-storage.ts apps/web/src apps/api/test apps/web/test tests/e2e docs/contracts`
> Plans 013–015 are expected to alter these files. Compare their completed
> interfaces with the target model below; stop if preview kind or measured
> result metadata is absent.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/013-multi-scene-storyboard-contract.md`,
  `plans/014-focused-storyboard-editor.md`,
  `plans/015-accurate-proxy-preview.md`
- **Category**: direction / product
- **Planned at**: commit `425bbd4`, 2026-08-01

## Why this matters

Users need a deliberate decision point: watch the exact proxy, edit it, or
approve it for final-quality output. The existing render screen only shows a
progress bar and cross-origin download link, so completed work cannot be
reviewed in-app and "final" is not tied to an approved revision. This plan adds
server-enforced approval, final playback, truthful output facts, and reliable
download behavior.

## Current state

- `apps/web/src/main.tsx:556-565` shows progress and a download button but no
  `<video>` result.
- `apps/api/src/server.ts:363-374` admits a render without preview or
  publishability checks.
- `apps/api/src/server.ts:450-468` returns one signed GET URL; playback and
  attachment download have no distinct content disposition.
- `apps/api/src/render-repository.ts:294-303` already joins current project
  revision and exposes stale truth.
- `PrivateObjectStore.signedGet` at `apps/api/src/media-storage.ts:205-211`
  signs a bare GET. Extend it rather than proxying large video bodies through
  the API.
- Plan 015 must provide `RenderKind`, immutable job profiles, measured result
  metadata, and accurate proxy playback before this begins.

## Target flow

```text
accurate current preview complete
        ├── Edit storyboard → revision changes → preview stale
        ├── Download preview (clearly proxy/watermarked)
        └── Create final export
                    ↓
             watch final in app
                    ↓
          Download MP4 | Edit project
```

Final admission is a server trust-boundary rule: a `final` job may be created
only when the same owner/project/revision has a completed, non-stale `preview`
result whose measured dimensions/duration passed plan 015 validation.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| API | `npm test --workspace apps/api` | exit 0 |
| Web | `npm test --workspace apps/web` | exit 0 |
| Worker | `npm test --workspace apps/worker` | exit 0 |
| E2E | `npm run test:e2e:web` | exit 0 |
| Full gates | `npm run lint && npm test && npm run build` | exit 0 |

## Scope

**In scope**:

- `apps/api/src/render-repository.ts`
- `apps/api/src/server.ts`
- `apps/api/src/media-storage.ts`
- API tests for admission, result, and signed download behavior
- `apps/web/src/main.tsx`, focused storyboard/preview components created by
  plans 014–015, `apps/web/src/api.ts`, `apps/web/src/style.css`
- Web unit tests and `tests/e2e/*`
- Client-boundary and host-integration docs
- `plans/README.md` status

**Out of scope**:

- Editor bundle/XML export (plan 017)
- Payments, credits, quotas, or billing labels
- Social-network publishing APIs
- Advanced editor controls
- Narration/music generation or an unconditional "audio required" policy
- Serving the private R2 bucket publicly

## Git workflow

- Branch: `advisor/016-final-playback-delivery`
- Suggested commits:
  - `feat: require a current preview before final render`
  - `feat: play and download final results in app`
  - `test: cover preview approval and final delivery`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Enforce final admission against preview truth

Add a repository method used inside final-job creation that locks/queries the
canonical completed preview for the same owner, project, and revision. Verify
its result metadata contains the measured fields plan 015 guarantees. Reject
final admission with a typed 422 when preview is missing, incomplete, failed,
stale, or malformed.

Do not rely on a browser boolean such as `approved=true`; the final POST itself
is the approval action for the current authoritative revision. Keep the
existing three-active-render capacity rule, counting preview/final consistently.

**Verify**: API integration tests cover no preview, running preview, failed
preview, older-revision preview, complete current preview, duplicate final
coalescing, and wrong owner. `npm test --workspace apps/api` → exit 0.

### Step 2: Separate inline playback from attachment download

Extend `PrivateObjectStore.signedGet` with a closed option such as
`disposition: "inline" | "attachment"` and a server-generated safe filename.
Map it to S3 `ResponseContentDisposition` and `ResponseContentType` while
signing. Never accept a raw disposition or filename from request input.

Expose authenticated result endpoints that return/redirect to:

- an inline short-lived URL for `<video>`;
- an attachment URL named from a sanitized project title/revision/kind, ending
  `.mp4`.

Keep owner scoping and five-minute expiry. Do not log signed URLs.

**Verify**: fake-S3 tests assert exact command inputs, safe ASCII fallback
filename, UTF-8 handling, owner scope, and no header injection from brief text.

### Step 3: Build the approval and final-progress UI

On a current accurate preview screen, show:

- native playback;
- measured resolution, duration, scene count, and audio status;
- `Edit storyboard`;
- `Download preview` with explicit proxy/watermark wording;
- `Create final export`.

When `Create final export` is selected, post `{ kind: "final" }`, follow SSE,
and allow cancellation/retry using the existing behavior. Disable duplicate
submits while the canonical job is queued/running. If the server reports the
preview is stale, return to the editor with direct recovery copy; never silently
render the newest revision.

Do not show an "Export to editor" button until plan 017 has a working endpoint.

**Verify**: web tests cover button states, stale conflict, retry, cancellation,
and double-submit prevention. `npm test --workspace apps/web` → exit 0.

### Step 4: Play and deliver the final result

After final completion, replace the progress-only screen with a native video
player using the inline URL. Show measured facts from the final result and:

- `Download MP4` using the attachment URL;
- `Edit project`, which returns to the persisted storyboard without deleting
  the immutable result;
- `Create new video`.

If the user edits after a final render, retain the old result as history but
label it as an older revision and require a new preview before another final.
Refresh expired playback URLs through authenticated API calls; never store
signed URLs in localStorage/sessionStorage.

Use `aria-live` only for status changes, not continuously updating video time.
Respect reduced motion and do not autoplay.

**Verify**: component tests and E2E confirm final player metadata loads,
download endpoint uses attachment disposition, editing makes the result old,
and browser storage contains no signed URL.

### Step 5: Extend the real E2E journey

Build on plan 012/015:

1. create and edit a multi-scene storyboard;
2. generate and play a proxy;
3. attempt final before preview in a direct API request and assert 422;
4. create final after preview completion;
5. probe final MP4 for final profile, full duration, streams, and revision;
6. verify the attachment response metadata/filename;
7. return to edit and assert prior preview/final are marked old.

Keep all provider/media fixtures deterministic and local.

**Verify**: `npm run test:e2e:web` → exit 0.

### Step 6: Run repository gates

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

- Final admission requires a current completed preview for the same owner and
  revision.
- Preview and final duplicate requests coalesce independently.
- Inline and attachment signed requests use safe server-generated headers.
- Proxy and final play without autoplay and refresh expired URLs.
- Edit preserves immutable old results but marks them stale.
- Failed/cancelled jobs never enable download.
- E2E probes both proxy and final profiles and full storyboard duration.

## Done criteria

- [ ] Server refuses final work without a current validated preview.
- [ ] Users can watch both proxy and final results inside F-Motion.
- [ ] Preview, edit, final, and download actions are distinct and truthful.
- [ ] MP4 download uses attachment disposition and a safe filename.
- [ ] Signed URLs remain short-lived, owner-scoped, and absent from browser
      storage/logs.
- [ ] All Node, browser, Prisma, package, and Flutter gates exit 0.
- [ ] Only in-scope files changed.
- [ ] Plan 016 is marked DONE in `plans/README.md`.

## STOP conditions

- Stop if plan 015 does not expose authoritative kind/stale/measured metadata.
- Stop if enforcing preview approval requires trusting client-supplied project
  revision or profile values.
- Stop if reliable attachment download requires making object storage public.
- Stop if product requirements introduce payment/credit settlement.
- Stop after two failed attempts at a verification step.

## Maintenance notes

- The preview requirement is product-host policy; the neutral renderer should
  remain able to render a validated snapshot for other hosts.
- Any future "approve" audit trail is a separate product decision; do not add
  personal analytics in this plan.
- Review signed response headers for injection and non-ASCII filenames.
