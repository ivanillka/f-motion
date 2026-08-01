# Plan 005: Keep render progress alive until a terminal phase

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f13f997..HEAD -- apps/api/src/server.ts apps/web/src/main.tsx apps/mobile/lib/main.dart packages/contracts/src/index.ts tests/e2e docs/contracts/client-boundary.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (verify with real FFmpeg after plan 001 if possible)
- **Category**: bug
- **Planned at**: commit `f13f997`, 2026-07-27

## Why this matters

`docs/contracts/client-boundary.md` requires reconnectable SSE progress with
monotonic event IDs. The API writes historical events and **closes** the
response. Web (and Android) poll with `Last-Event-ID` but stop after **30**
attempts × 250ms ≈ **7.5s**. Longer FFmpeg previews will appear stuck/failed
even when the worker is still rendering.

## Current state

`apps/web/src/main.tsx`:

```ts
async function followRender(id: string, lastEventId = "") {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`/api/render-jobs/${id}/events`, {
      headers: {
        authorization: `Bearer ${token}`,
        ...(lastEventId ? { "last-event-id": lastEventId } : {})
      }
    });
    // … parse SSE blocks …
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
```

`apps/api/src/server.ts` events route: load events → write SSE → `response.end()`.

`packages/contracts/src/index.ts` — `RenderProgress.phase` includes
`queued | preparing | rendering | uploading | complete | cancelled` (no
`failed` yet). Web already treats `failed` as terminal if it appears.

E2E (`tests/e2e/web-flow.spec.ts`) expects reconnect with
`last-event-id` values `1` then `2` and a quick complete — keep that behavior.

`docs/contracts/client-boundary.md`:

> Jobs expose progress through versioned SSE events… Reconnection sends the
> last received event ID; the API resumes…

Preferred fix (smallest that matches the contract): **hold the SSE connection
open**, poll the render repository for new events until a terminal phase or
client disconnect, writing each new event as it appears. Alternative acceptable
ponytail: keep short responses but **remove the 30-attempt cap** on clients and
add backoff + explicit timeout only on true wall-clock budget (e.g. 10 minutes).
Prefer the server long-lived SSE approach so mobile/web share one behavior.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Tests | `npm test` | exit 0 |
| E2E | `npm run test:e2e:web` | 1 passed |

## Scope

**In scope**:
- `apps/api/src/server.ts` — events endpoint streaming semantics
- `apps/api/src/render-repository.ts` — only if helpers needed for wait/poll
- `apps/web/src/main.tsx` — consume long-lived stream **or** unbounded poll
- `apps/mobile/lib/main.dart` — mirror the same client contract (minimal change)
- `apps/api/test/render-persistence.test.mjs` or route tests
- `tests/e2e/web-flow.spec.ts` / `tests/e2e/run-servers.mjs` if timing assumptions break
- `packages/contracts/src/index.ts` — add `failed` to phase union **only if**
  the API can emit it; otherwise leave unchanged
- `plans/README.md` status

**Out of scope**:
- Implementing durable terminal failure writes in the worker (deferred finding)
- Redis/pubsub or new infrastructure
- Changing progress percent semantics / phase names besides optional `failed`

## Git workflow

- Branch: current or `advisor/145-render-progress-sse`
- Commits: `fix: stream render progress until terminal phase`
- Do NOT push unless asked

## Steps

### Step 1: Choose and document the ponytail in code

At the events route, add a one-line `ponytail:` comment stating the ceiling
(e.g. DB poll every 500ms while SSE open; upgrade to LISTEN/NOTIFY later).

Implement **long-lived SSE**:

1. Set SSE headers; flush historical events after `last-event-id` as today.
2. If last written event is already terminal (`complete` | `cancelled` |
   `failed` if present), end the response.
3. Otherwise loop: wait ~500ms, fetch newer events, write them, break on
   terminal or `request` close / abort.
4. Cap the loop with a generous wall clock (e.g. 15 minutes) then end with
   last known state — never the old 7.5s client cap alone.

**Verify**: Unit/route test with a fake `renders.events` that returns queued
then, after a delay, complete — client/reader sees both without reconnecting
**or** e2e still passes with reconnect if you keep short responses + client fix.

### Step 2: Fix web client

If using long-lived SSE: use `fetch` + readable stream **or** `EventSource`
with Authorization constraints. This app today uses `fetch` + Bearer — keep
fetch streaming if EventSource cannot send Authorization.

Remove `attempt < 30`. Stop only on terminal phase, abort, or explicit max
wait matching server.

Preserve `Last-Event-ID` reconnect if the connection drops mid-job (loop
reconnect without a tiny attempt cap; use backoff).

**Verify**: `npm run test:e2e:web` still passes. Extend e2e only if needed to
assert no premature stop (optional).

### Step 3: Align Android

Mirror the web wait semantics in `apps/mobile/lib/main.dart` progress loop
(remove equivalent short caps). Run `dart test` / existing mobile tests if
Flutter SDK is available; if not, make the Dart change carefully and note
BLOCKED on flutter test in the plan status.

**Verify**: `cd apps/mobile && flutter test` when SDK present; else
`rg -n "attempt|30|250" apps/mobile/lib/main.dart` shows no hard 7.5s abandon.

### Step 4: Keep e2e reconnect assertion honest

`web-flow.spec.ts` currently expects `resumedFrom` to equal `["1","2"]` because
the fake API closes after each event batch. If long-lived SSE means **zero**
reconnects in the happy path, **update the e2e expectation** accordingly (e.g.
empty resumes, or force a disconnect test). Do not leave a lying assertion.

**Verify**: `npm run test:e2e:web` → 1 passed with assertions matching the new
protocol.

## Test plan

| Case | Where |
|------|--------|
| historical events still filtered by last-event-id | api render tests |
| stream waits for later event / client waits >7.5s | new api or e2e test |
| terminal phase ends follow loop | web logic or e2e |
| e2e download still works | `tests/e2e/web-flow.spec.ts` |

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run test:e2e:web` exits 0 with expectations updated to the real protocol
- [ ] No client hard-stop at 30×250ms (`rg -n "attempt < 30" apps/web/src/main.tsx`
      returns nothing)
- [ ] Server either holds SSE open until terminal or clients poll without the
      7.5s cap — documented in a `ponytail:` comment
- [ ] `plans/README.md` 005 → DONE

## STOP conditions

- Authorization cannot be sent with the only streaming API available in the
  target browsers — report and fall back to unbounded fetch-poll without
  inventing cookies.
- E2E harness cannot simulate long-lived SSE without a large rewrite — keep
  harness working; add a focused API test instead; STOP if e2e must be deleted.
- Worker never emits progress for >15 minutes due to unrelated bugs — fix is
  not infinite wait without a wall-clock cap.

## Maintenance notes

- Pair later with durable `failed` job state (deferred ARCH finding).
- Reviewers: check abort/disconnect clears timers; no per-render busy-loop at
  4 Hz forever after completion.
- Mobile and web must stay on the same reconnect semantics
  (`docs/contracts/client-boundary.md`).
