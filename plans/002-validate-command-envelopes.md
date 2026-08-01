# Plan 002: Validate command envelopes at the API/domain boundary

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f13f997..HEAD -- apps/api/src/server.ts apps/api/src/domain.ts packages/reel-engine/src/index.ts packages/contracts/src/index.ts packages/reel-engine/test apps/api/test`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (can parallel 001)
- **Category**: bug
- **Planned at**: commit `f13f997`, 2026-07-27

## Why this matters

`docs/contracts/client-boundary.md` requires validated command payloads.
Today the API spreads the request body into the domain, and
`applyCommand` treats any non-`select_concept` / non-`update_scene` kind as a
reorder. Malformed clients get 500s or persist invalid scene JSON that later
breaks snapshots and renders.

## Current state

`apps/api/src/server.ts` (command route):

```ts
response.json(await projects.command(ownerId, { ...request.body, project_id: request.params.projectId }));
```

`packages/reel-engine/src/index.ts` — after `update_scene`, fallthrough reorder:

```ts
if (command.kind === "update_scene") { /* ... */ }
const sceneId = String(command.payload.scene_id ?? "");
const to = Number(command.payload.to);
// ... reorder — no `kind === "reorder_scene"` guard
```

`packages/contracts/src/index.ts` already types:

```ts
kind: "select_concept" | "update_scene" | "reorder_scene";
```

`docs/contracts/client-boundary.md` — mutations use a command envelope with
`command_id`, `project_id`, `base_revision`, kind, payload; stale revisions
reject without merge.

Exemplar tests: `packages/reel-engine/test/engine.test.mjs`,
`apps/api/test/domain.test.mjs`, `apps/api/test/auth-routes.test.mjs`
(node:test + assert/strict). Match that style.

AGENTS.md: smallest direct implementation; leave a runnable check for
non-trivial validation.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run lint` | exit 0 |
| Engine tests | `npm test --workspace packages/reel-engine` | all pass |
| API tests | `npm test --workspace apps/api` | all pass |
| Full unit | `npm test` | exit 0 |
| E2E | `npm run test:e2e:web` | 1 passed |

## Scope

**In scope**:
- `packages/reel-engine/src/index.ts`
- `packages/reel-engine/test/engine.test.mjs` (extend)
- `packages/contracts/src/index.ts` (only if adding a shared validate helper type/export)
- `apps/api/src/server.ts` (map validation errors → HTTP 422 `{ type: "validation", message }`)
- `apps/api/src/domain.ts` (only if command entry should throw a typed validation error before persist)
- `apps/api/test/*.mjs` (add/adjust route or domain tests)
- `plans/README.md` status row

**Out of scope**:
- Validating that `media_id` references a ready owned asset (plan 004)
- OpenAPI regeneration / `/v1` path renames
- Web/Android UI changes beyond keeping existing command shapes working
- Media upload routes

## Git workflow

- Branch: current advisor branch or `advisor/142-command-validation`
- Commits: `fix: reject invalid command envelopes` / `test: cover unknown command kinds`
- Do NOT push unless asked

## Steps

### Step 1: Make `applyCommand` kind-exhaustive

In `packages/reel-engine/src/index.ts`:

1. Handle `reorder_scene` only inside `if (command.kind === "reorder_scene") { … }`.
2. For any other kind, throw an error whose message is stable and includes
   `unknown command` or `invalid command` (pick one phrase and use it in tests).
3. For `update_scene`, validate the scene object fields before `as Scene`
   (required keys, types, then existing `boundedScene`). Reject missing/invalid
   `media_id` **shape** (must be string UUID-or-opaque id if present) but do
   **not** check DB ownership here.

**Verify**: `npm test --workspace packages/reel-engine` — existing tests pass.
Add failing-first tests in step 2.

### Step 2: Engine unit tests for validation

Extend `packages/reel-engine/test/engine.test.mjs`:

- unknown `kind` (e.g. `"nope"`) throws
- `reorder_scene` with valid `scene_id`/`to` succeeds (may need a 2-scene
  snapshot — build one in the test)
- `update_scene` with non-object `scene` throws
- `update_scene` with caption > 180 still throws (existing `boundedScene`)

**Verify**: `npm test --workspace packages/reel-engine` → all pass including new cases.

### Step 3: HTTP 422 for validation failures

In `apps/api/src/server.ts` command handler, catch validation-style errors from
the domain/engine and return:

```json
{ "type": "validation", "message": "…" }
```

with status **422**. Keep 409 conflict / 404 not_found behavior.

Prefer a small typed error class (e.g. `ValidationError`) in `domain.ts` or
`reel-engine` rather than matching message strings in the route — but do not
build a framework.

Add an API test (createTestApp) that POSTs an invalid kind and expects 422.
Model after `apps/api/test/auth-routes.test.mjs`.

**Verify**: `npm test --workspace apps/api` → pass.
`npm run test:e2e:web` → still 1 passed (web only sends valid kinds).

## Test plan

| Case | Where |
|------|--------|
| unknown kind rejected | `packages/reel-engine/test/engine.test.mjs` |
| reorder_scene happy path | same |
| update_scene bad payload | same |
| HTTP 422 mapping | `apps/api/test/` new or extended file |

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0 with new engine + API validation tests
- [ ] `npm run test:e2e:web` exits 0
- [ ] `rg -n "kind === \"reorder_scene\"" packages/reel-engine/src/index.ts` matches
- [ ] Unknown kinds cannot fall through to reorder (`rg` / test proves it)
- [ ] No out-of-scope files modified
- [ ] `plans/README.md` 002 → DONE

## STOP conditions

- Web or Android clients already send a fourth command kind not in contracts —
  stop and report (do not invent kinds).
- Validation belongs in a generated OpenAPI middleware the repo does not have —
  do not add a new framework; keep hand-written checks.
- Drift in `applyCommand` control flow vs excerpts.

## Maintenance notes

- Plan 004 will add ownership checks for `media_id` after shape validation.
- Reviewers: ensure error type `validation` matches `ApiError` in contracts;
  add `"unauthorized"` only if already used elsewhere — do not widen the union
  casually.
- Deferred: JSON Schema codegen from `packages/contracts`.
