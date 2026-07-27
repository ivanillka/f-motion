# Plan 009: Persist render failures and atomic media-inspect outbox

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat afd8112..HEAD -- apps/worker/src/runtime.ts apps/worker/src/queue.ts apps/api/src/server.ts apps/api/src/start.ts apps/api/src/render-repository.ts apps/worker/test apps/api/test`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (pairs well after 008 for hosted reliability)
- **Category**: bug / correctness
- **Planned at**: commit `afd8112`, 2026-07-27

## Why this matters

Two deferred queue debts from the prior improve round:

1. Render SSE treats `failed` as terminal (`apps/api/src/server.ts`), and
   `RenderJob.state` allows `failed`, but the worker **never writes** `failed` —
   FFmpeg/S3/DB errors leave jobs `running` until the 15m client ceiling.
2. `docs/decisions/queue.md` requires API transactions to use an outbox so
   enqueue cannot race commit. Render create already does job+outbox in one
   transaction; media `/complete` does `markInspecting` then a **separate**
   outbox insert — a crash leaves assets stuck `inspecting` forever.

## Current state

Worker render (`apps/worker/src/runtime.ts`) — success path only; errors throw:

```ts
await renderPreview(output, snapshot, signal, mediaInputs);
…
await client.query(`UPDATE "RenderJob" SET state = 'complete' WHERE id = $1`, [job.jobId]);
…
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
}
```

`rg` finds no `state = 'failed'` writer under `apps/worker`.

Media complete (`apps/api/src/server.ts`):

```ts
if (!await options.media.repository.markInspecting(...)) { return 409; }
await options.media.enqueueInspection(asset.id, ownerId, request.params.projectId);
```

`enqueueInspection` in `apps/api/src/start.ts` is a standalone
`INSERT INTO "WorkOutbox" …`.

Render create exemplar (`apps/api/src/render-repository.ts`) — **match this**:

```ts
await client.query("BEGIN");
… INSERT RenderJob …
… INSERT WorkOutbox …
await insertEvent(client, jobId, "queued", 0);
await client.query("COMMIT");
```

Decision: `docs/decisions/queue.md` — “API transactions use an outbox row so
enqueue cannot race commit.”

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npm run lint` | exit 0 |
| Worker tests | `npm test --workspace apps/worker` | exit 0 |
| API tests | `npm test --workspace apps/api` | exit 0 |
| E2E | `npm run test:e2e:web` | 1 passed |

## Scope

**In scope**:
- `apps/worker/src/runtime.ts` (and possibly `queue.ts` if failure is handled at work wrapper)
- `apps/api/src/server.ts` / media repository / `start.ts` enqueue (atomic complete)
- Tests under `apps/worker/test`, `apps/api/test`
- `plans/README.md` status

**Out of scope**:
- Outbox `FOR UPDATE SKIP LOCKED` multi-worker claim optimization (follow-up)
- Changing pg-boss retry counts
- Client UI redesign for failure copy (existing clients already treat `failed`)

## Git workflow

- Branch: `advisor/148-render-fail-outbox` or current
- Commits: `fix: persist render job failed terminal state`,
  `fix: enqueue media inspection in the same transaction as inspecting`
- Do NOT push unless asked

## Steps

### Step 1: Mark render jobs `failed` on permanent handler failure

In the worker render handler (or `boss.work` wrapper), when `render` throws
after retries are exhausted **or** on each attempt if pg-boss will not call
again — prefer: catch inside `handlers.render`, and if the job is still
`running`/`queued`, transactionally:

```sql
UPDATE "RenderJob" SET state = 'failed' WHERE id = $1 AND state IN ('queued', 'running');
INSERT INTO "RenderEvent" ("jobId", phase, percent) VALUES ($1, 'failed', 0);
```

Do not overwrite `cancelled` or `complete`. Re-throw or return after persist so
pg-boss retry policy stays coherent — if you swallow the error, document why
retries stop. Smallest correct approach: persist `failed` only when you intend
the job to be terminal (e.g. after catching and deciding not to retry, or on
final attempt). If unsure, persist `failed` in a `finally`-adjacent catch when
`renderPreview` / upload throws, and rely on singleton keys for idempotent
result keys on any later retry of a *new* job.

**Verify**: worker unit/integration test that forces `renderPreview` to reject
(mock or abort) and asserts `RenderJob.state === 'failed'` and a `failed`
`RenderEvent`. Pattern: `apps/worker/test/runtime-integration.test.mjs` or a
focused unit with a fake store/pool.

### Step 2: Atomic media inspect outbox

Refactor so `markInspecting` + `WorkOutbox` insert share one DB transaction on
the same client:

- Extend `PostgresMediaRepository.markInspecting` to accept a `PoolClient`, **or**
- Add `completeAdmission(ownerId, projectId, assetId)` that does both, **or**
- Pass a transactional `enqueueInspection(client, …)` from the route after
  beginning a transaction.

Match the render-repository BEGIN/COMMIT style. Keep
`ON CONFLICT ("dedupeKey") DO NOTHING` for idempotent complete retries.

Update `enqueueInspection` in `start.ts` accordingly (may become a repository
method used by the route).

**Verify**: API test (unit with mock pool client ordering, or integration) that
proves both rows commit together. At minimum: after successful complete, a
`WorkOutbox` row exists with `dedupeKey = inspect-media:<assetId>` and asset
state is `inspecting`. Document that a forced failure between the two statements
is impossible after the refactor (`rg` shows one transaction).

### Step 3: Regression gates

**Verify**:

```sh
npm run lint
npm test --workspace apps/worker
npm test --workspace apps/api
npm run test:e2e:web
```

All exit 0.

## Test plan

| Case | Where |
|------|--------|
| FFmpeg/render throw → job `failed` + event | worker test |
| cancelled job not overwritten to failed | worker test |
| complete creates inspecting + outbox atomically | api test |
| complete idempotent via dedupeKey | api test |

## Done criteria

- [ ] Worker can write `RenderJob.state = 'failed'` and a `failed` event
- [ ] `rg -n "state = 'failed'" apps/worker` finds a writer
- [ ] Media complete uses one transaction for inspecting + outbox
- [ ] Lint/tests/e2e green
- [ ] `plans/README.md` 009 → DONE

## STOP conditions

- pg-boss final-failure hook cannot be observed without rewriting the queue
  layer — implement fail-persist inside `handlers.render` catch and STOP if
  that cannot cover retry exhaustion cleanly; report options.
- Atomic complete appears to require schema changes beyond `WorkOutbox` —
  stop; schema already supports the pattern.

## Maintenance notes

- Reviewers: cancelled/complete must stay sticky; outbox matches
  `docs/decisions/queue.md`.
- Follow-up: `FOR UPDATE SKIP LOCKED` on undispatched outbox rows for multi-worker.
- Clients (`apps/web`, `apps/mobile`) already stop SSE on `failed` — confirm
  copy remains acceptable.
