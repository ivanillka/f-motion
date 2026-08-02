# Plan 054: Wire `final` export and honest download UX

> **Executor instructions**: Execute on the **ship tip** from plan 053 (product
> lineage containing `6287cce`), not on divergent `8125787`. Follow steps in
> order. Update `plans/README.md` when done unless a reviewer maintains it.
>
> **Drift check (run first)**:
> `git diff --stat 6287cce..HEAD -- apps/web/src/main.tsx apps/api/src/server.ts apps/api/src/render-repository.ts apps/worker/src/runtime.ts tests/e2e/web-flow.spec.ts`
> On excerpt mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plan 053 (ship tip); API already supports `preview` \| `final`
  since earlier render work on tip
- **Category**: direction
- **Planned at**: commit `6287cce`, 2026-08-02

## Why this matters

The API and worker already distinguish render kinds and profiles, but the web
client always requests `preview` and labels the artifact "Download preview".
Users never get the higher-resolution final profile the stack already defines
(`RENDER_*` → 720×1280 vs `PREVIEW_RENDER_*` → 540×960). Without a final path,
the product has no finished deliverable.

## Current state

API accepts both kinds and freezes the matching profile:

```800:806:apps/api/src/server.ts
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)
        || !["preview", "final"].includes(String(request.body.kind))
        ...
      const job = await options.renders.create(ownerId, request.params.projectId, request.body.kind as RenderKind);
```

```6:18:apps/api/src/render-repository.ts
export type RenderKind = "preview" | "final";
...
  return { preview: profile("PREVIEW_RENDER", [540, 960]), final: profile("RENDER", [720, 1280]) };
```

```194:194:apps/api/src/render-repository.ts
        renderProfile: structuredClone(this.profiles[kind]),
```

Web hardcodes preview:

```783:788:apps/web/src/main.tsx
  async function requestRender() {
    if (!project) return;
    const job = await api.request<{ job_id: string }>(`/api/projects/${project.id}/render`, {
      method: "POST",
      body: JSON.stringify({ kind: "preview" })
    });
```

```1713:1727:apps/web/src/main.tsx
    {authReady && step === "render" && <section>
      <h1>Accurate preview</h1>
      ...
        <a href={downloadUrl} download><button disabled={!downloadUrl || progress.phase === "failed"}>Download preview</button></a>
```

Worker already loads `kind` from the job and validates output against the stored
profile (`apps/worker/src/runtime.ts` ~309–332, ~529). E2E
`tests/e2e/web-flow.spec.ts` asserts a downloadable MP4 after the journey.

Design constraint: keep one composition and one primary CTA group on the render
step — do not turn this into a dashboard. Match existing web patterns in
`main.tsx` (plain buttons/sections, no new design system).

Do **not** claim commercial-rights packaging or Gate 0 legal clearance in UI
copy. A short honest label is enough (e.g. "Final export" vs "Preview").

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Web unit tests | `npm test --workspace apps/web` | exit 0 |
| API render tests | `npm test --workspace apps/api -- render` | exit 0 |
| E2E | `npm run test:e2e:web` | exit 0 |
| Full gate | `npm run lint && npm test && npm run build` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/main.tsx` (and `style.css` only if a tiny layout tweak is
  required for two clear actions)
- `apps/web/test/*.mjs` if render helpers need updating
- `tests/e2e/web-flow.spec.ts` — cover at least one `final` download path **or**
  a focused API-level assert plus UI control visibility (prefer one e2e click
  path if cheap)
- Optional: assert in an existing API test that `kind: "final"` stores the
  final profile dimensions
- `plans/README.md` status

**Out of scope**:

- Rights/attribution ZIP package (direction E — separate later plan)
- Format selection YT/Reel/Story (direction C)
- Changing default profile numbers unless env docs already disagree
- Watermark policy redesign
- Flutter client
- Renaming SSE phases

## Git workflow

- Branch: `advisor/054-wire-final-export` from ship tip (053)
- Isolated worktree preferred
- Commit: `feat: let users request final export downloads`
- Do NOT push unless asked

## Steps

### Step 1: Confirm server/worker already honor `final`

Read `renderProfilesFromEnv` and one create-path test. Add or extend an API
test so `POST .../render` with `{ "kind": "final" }` returns 202 and the stored
job profile width/height match `profiles.final` (720×1280 with default env).

**Verify**: `npm test --workspace apps/api -- render` (or the specific test
file name already used for render persistence) passes with the new assertion.

### Step 2: Web — choose preview vs final without clutter

On the editor → render boundary (same place `requestRender` is triggered):

1. Keep the existing accurate-preview path as the default primary action.
2. Add a clear secondary action to request `kind: "final"` (button label like
   "Export final" — not a card grid).
3. Track `renderKind` in component state for the active job.
4. On the render step, set heading/status/download label from `renderKind`
   (`Accurate preview` / `Download preview` vs `Final export` / `Download export`).
5. Show rendered metadata dimensions when present (already partially shown) so
   a final job visibly differs (720×1280 vs 540×960 under defaults).

Do not add format pickers, rights checklists, or billing copy.

**Verify**: `npm test --workspace apps/web` and `npm run lint`.

### Step 3: E2E — one final path

Extend `tests/e2e/web-flow.spec.ts` (or add a sibling test in the same file)
so after media is ready the UI can start a **final** render and download an MP4.
Reuse `expectRenderedProject`. Prefer stubbing only what existing tests stub.

If full e2e is environment-blocked, STOP and report rather than deleting the
gate; do not mark DONE without either e2e green or operator-accepted BLOCKED
note in README.

**Verify**: `npm run test:e2e:web` exit 0 (or documented BLOCKED).

### Step 4: Full gate + README

```sh
npm run lint && npm test && npm run build
```
Update plan 054 status.

## Test plan

| Case | Where |
|------|--------|
| API `kind: "final"` freezes final profile | API render test |
| UI sends `final` when export clicked | web unit or e2e |
| Download label matches kind | e2e or web test |
| Preview path unchanged | existing e2e still green |

## Done criteria

- [ ] User can request `final` from the web UI
- [ ] Download/chrome copy does not call a final artifact a "preview"
- [ ] Default preview path still works
- [ ] Stored final jobs use final render profile dimensions
- [ ] Lint/test/build exit 0; e2e green or README BLOCKED with reason
- [ ] No out-of-scope files; README updated

## STOP conditions

- Ship tip missing `RenderKind` / dual profiles (wrong baseline)
- Final vs preview profiles are identical in env and there is no documented way
  to differentiate — report; do not invent a third profile system
- Product asks for rights ZIP or platform picker inside this change
- E2E cannot run and operator has not accepted BLOCKED

## Maintenance notes

- Reviewers: ensure watermark env (`RENDER_WATERMARK` vs
  `PREVIEW_RENDER_WATERMARK`) still applies per kind.
- Follow-up: per-export rights package (direction E) and format selection
  (direction C) should build on this, not replace it.
- Production FAL flags remain unrelated; this plan is render export only.
