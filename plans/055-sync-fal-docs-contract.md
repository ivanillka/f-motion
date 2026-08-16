# Plan 055: Sync docs and generation routes in the contract inventory

> **Executor instructions**: Execute on the ship tip (plan 053 / `6287cce`
> lineage). Docs + contract only — no generation behavior changes. Update
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat 6287cce..HEAD -- README.md docs/getting-started.md packages/contracts/route-inventory.json packages/contracts/openapi.yaml packages/contracts/test/contracts.test.mjs apps/api/test/contract-routes.test.mjs apps/api/src/server.ts`
> On mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plan 053 preferred (tip with 049/050 routes present)
- **Category**: docs / tests
- **Planned at**: commit `6287cce`, 2026-08-02

## Why this matters

Two sources of truth disagree with the running server:

1. Root `README.md` still says "AI generation is deliberately not implemented"
   while earlier paragraphs and `DESIGN.md` describe BYOK FAL still + image-to-video.
2. `packages/contracts/route-inventory.json` lists FAL **credential** routes but
   omits generation quote/confirm/get/cancel routes that `apps/api/src/server.ts`
   already serves. Contract tests treat the inventory as authoritative — clients
   and OpenAPI drift silently.

## Current state

Contradictory README (tip):

```65:69:README.md
The reference journey accepts a short brief, then either user-owned media or
licensed Pexels footage from the user's account, and produces an accurate
vertical preview. AI generation is deliberately not implemented. Settings
connects and validates user-owned Pexels and optional FAL credentials; it never
returns their values to the browser.
```

(Contrast with README lines ~29–31 on the same tip, which already describe Flux
still + Hailuo image-to-video under the owner's key.)

`docs/getting-started.md` (~132):

```text
AI generation, payments, and third-party paid-provider integrations are not
included.
```

Server generation routes (present; inventory missing them):

```text
POST /api/projects/:projectId/scenes/:sceneId/fal/image-quotes
POST /api/projects/:projectId/scenes/:sceneId/fal/video-quotes
POST /api/generation-jobs/:jobId/confirm
GET  /api/generation-jobs/:jobId
POST /api/generation-jobs/:jobId/cancel
```

Inventory today only has credential paths under `/providers/fal/credential`
(`packages/contracts/route-inventory.json`).

`DESIGN.md` already states FAL is BYOK-only — prefer aligning README/getting-started
to DESIGN, not the reverse.

Error types already partially present (`fal_not_connected`, etc.); add any
generation-specific types the server returns that inventory lists under
`error_types` (e.g. `fal_generation_busy` from `falGenerationHttpError`).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Contract package tests | `npm test --workspace packages/contracts` | exit 0 |
| API contract route test | `npm test --workspace apps/api -- contract-routes` | exit 0 |
| Lint / full | `npm run lint && npm test && npm run build` | exit 0 |

## Scope

**In scope**:

- `README.md` — remove/fix the "AI generation is deliberately not implemented"
  contradiction; keep BYOK + no-secret-return guarantees; keep Gate 0 / legal
  caution for production enablement
- `docs/getting-started.md` — same honesty: optional FAL generation when flags
  enabled; still not "managed credits"
- `packages/contracts/route-inventory.json` — add the five generation routes
  (versioned paths **without** the `/api` prefix, matching existing inventory
  style)
- `packages/contracts/openapi.yaml` — document the same routes at the level of
  neighboring provider endpoints (request/response sketches consistent with
  current JSON views)
- `packages/contracts/test/contracts.test.mjs` and/or
  `apps/api/test/contract-routes.test.mjs` if they assert inventory completeness
  against `server.ts`
- `error_types` entries that the API already emits for generation
- `plans/README.md` status

**Out of scope**:

- Changing runtime route paths or handlers
- Enabling `FENGINE_FAL_BYOK_ENABLED` by default
- Gate 0 legal evidence pack (direction D)
- Flutter contract regeneration beyond what 042 already deferred
- Rewriting DESIGN.md unless a single cross-link sentence is required

## Git workflow

- Branch: `advisor/055-sync-fal-docs-contract` from ship tip
- Commit: `docs: align README and contract inventory with FAL generation`
- Do NOT push unless asked

## Steps

### Step 1: Fix README + getting-started contradiction

Replace the false "not implemented" claims with accurate text:

- Optional owner-keyed FAL still (Flux Schnell) and image-to-video when BYOK is
  enabled and Gate 0 evidence is accepted for production.
- Settings never returns credential values.
- No platform/managed FAL key fallback.

Keep Verify/command sections intact.

**Verify**:
```sh
rg -n "deliberately not implemented|AI generation, payments" README.md docs/getting-started.md
```
→ no stale denials that contradict BYOK generation on tip.

### Step 2: Extend route inventory

Add versioned entries (path shape like existing inventory, no `/api` prefix),
auth `bearer`:

| method | path |
|--------|------|
| POST | `/projects/{project_id}/scenes/{scene_id}/fal/image-quotes` |
| POST | `/projects/{project_id}/scenes/{scene_id}/fal/video-quotes` |
| POST | `/generation-jobs/{job_id}/confirm` |
| GET | `/generation-jobs/{job_id}` |
| POST | `/generation-jobs/{job_id}/cancel` |

Add missing `error_types` used by `falGenerationHttpError` /
credential busy mapping if absent (read `apps/api/src/fal-generation.ts` and
`fal-credentials.ts` for exact `type` strings).

**Verify**: `npm test --workspace packages/contracts` and
`npm test --workspace apps/api -- contract-routes`.

### Step 3: OpenAPI parity

Update `packages/contracts/openapi.yaml` so the new inventory routes have
operations. Match verbosity of existing `/providers/fal/credential` entries —
enough for contract tests, not a novel schema language.

**Verify**: contract tests still parse OpenAPI; no secret examples.

### Step 4: Full gate

```sh
npm run lint && npm test && npm run build
```
Update README plan row 055.

## Test plan

- Inventory contains all five generation routes
- API contract-routes test still passes (and fails if a route is removed)
- No test should require live FAL

## Done criteria

- [ ] README/getting-started no longer claim AI generation is unimplemented
- [ ] Inventory + OpenAPI include generation routes present in `server.ts`
- [ ] Error types include generation busy / related types actually returned
- [ ] Contract + full gate green
- [ ] No runtime behavior changes; README plan status updated

## STOP conditions

- Inventory path convention differs from server mounting in a way you cannot
  reconcile without changing Express paths — STOP (do not rename live routes
  here)
- OpenAPI tooling in-repo rejects a change you cannot fix within contracts
  package tests
- Drift shows generation routes already inventoried and docs already fixed —
  mark REJECTED/DONE appropriately without churn

## Maintenance notes

- Any new `/fal/*` or `/generation-jobs/*` route must update inventory in the
  same PR (042's contract authority rule).
- Production enablement copy must continue to mention Gate 0 evidence — do not
  advertise unrestricted paid generation.
