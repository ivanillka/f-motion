# Plan 053: Promote product tip `6287cce` as the sole ship tip

> **Executor instructions**: This is a **git integration / tip promotion** plan,
> not a feature rewrite. Follow the steps in order. Do not invent a mega-merge
> of unrelated ancient history. When done, update `plans/README.md` unless a
> reviewer maintains it.
>
> **Drift check (run first)**:
> ```sh
> git rev-parse --short HEAD
> git merge-base --is-ancestor 6287cce HEAD; echo tip_ancestor:$?
> git merge-base --is-ancestor 8125787 HEAD; echo export_merge_ancestor:$?
> ls packages/
> ```
> Expected starting point for work: a worktree whose `HEAD` **is** `6287cce` or
> already contains it (plans 051–052 preferably applied). `packages/` must list
> `fal-host`. If you are on `8125787` alone and `packages/fal-host` is missing,
> you are on the wrong fork — see Step 1.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: HIGH
- **Depends on**: tip `6287cce` (050 DONE); **preferred** 051 and 052 committed
  on that lineage first
- **Category**: tech-debt / migration
- **Planned at**: commit `6287cce`, 2026-08-02

## Why this matters

The operator's main checkout `advisor/export-quality-merge` @ `8125787` and the
product tip `advisor/050-fal-scene-image-to-video` @ `6287cce` **diverged** at
`20365f9`. Neither is an ancestor of the other (~45 commits on the export-merge
side vs ~20 on the product side from that base). Continuing to plan and deploy
from the export-merge checkout strands FAL BYOK, multi-scene storyboard, and
contract work. A single ship tip is required before final-export UX (054) and
hosted rollout.

Important fact verified at plan time: product tip **already includes** focal
cover crop, zoompan motion, ASS captions, and multi-scene concat in
`apps/worker/src/index.ts`. The uniquely numbered commits `6f9290e`–`8125787`
on the export-merge branch are **not** missing features that must be
cherry-picked for those behaviors to exist on tip — they are an alternate
history. Do **not** attempt to merge all 45 export-merge commits onto tip.

## Current state

| Ref | Role | Has `packages/fal-host`? |
|-----|------|---------------------------|
| `6287cce` | Product tip (048–050, 040–047 lineage from `1690eae`) | yes |
| `8125787` | Divergent local `advisor/export-quality-merge` checkout | **no** |
| `20365f9` | Merge-base of the two | n/a |
| `1690eae` | Deployed `advisor/133-design-contract` ancestor of tip | tip contains it |

`git log --oneline 8125787..6287cce` starts with FAL/storyboard product commits.
`git log --oneline 6287cce..8125787` is mostly older Gate 2 / spike / alternate
export-quality history.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Show tips | `git rev-parse --short HEAD 6287cce 8125787 2>/dev/null` | SHAs print |
| Full gate on ship tip | `npm run lint && npm test && npm run build` | exit 0 |
| Package consumer | `npm run test:package-consumer` | exit 0 |
| Web e2e (when env allows) | `npm run test:e2e:web` | exit 0 |

## Scope

**In scope**:

- Creating/updating a ship branch (recommended name:
  `advisor/053-product-tip` or operator-approved successor of
  `advisor/133-design-contract`) whose tip is `6287cce` **plus** 051/052 if
  those commits exist
- Documenting in `plans/README.md` which SHA is the ship tip
- Optionally resetting or retiring the divergent local branch pointer
  `advisor/export-quality-merge` **only** with operator confirmation (see STOP)
- Minimal docs note in README index about the retired divergent checkout

**Out of scope**:

- Re-implementing 012–016 as new commits
- Merging `8125787` into tip with recursive conflict resolution of all 147
  differing paths
- Deploying to Fly/Pages
- Plan 054 final-export UI
- Flutter / mobile work
- Force-pushing to `main` / `master` or any shared protected branch without
  explicit operator order

## Git workflow

- Work in an isolated worktree checked out from `6287cce` (or 051/052 tip)
- Branch: `advisor/053-product-tip`
- Do **not** push unless the operator asks
- Do **not** rewrite published history on `origin/advisor/133-design-contract`
  unless the operator explicitly requests that update

## Steps

### Step 1: Establish the worktree on the product lineage

```sh
# From repo root — adjust path if a worktree already exists
git fetch origin 2>/dev/null || true
git rev-parse --verify 6287cce
git worktree add .worktrees/053-product-tip 6287cce
cd .worktrees/053-product-tip
git checkout -b advisor/053-product-tip
ls packages/   # must include fal-host
```

If plans 051 and 052 already have commits, cherry-pick or merge those branches
onto this worktree **before** calling the tip "ship ready".

**Verify**: `test -d packages/fal-host` and
`git merge-base --is-ancestor 6287cce HEAD` succeeds.

### Step 2: Do not merge the divergent export-quality-merge history

Explicitly **skip**:

```sh
git merge 8125787   # DO NOT
```

If a file-by-file comparison is needed for peace of mind, use read-only diffs:

```sh
git diff --stat 6287cce 8125787 -- apps/worker/src/index.ts
```

Only cherry-pick a commit from `8125787` if you find a **concrete defect** on
tip that that commit uniquely fixes, and the patch applies cleanly. Otherwise
leave tip as-is. Record any rejected cherry-picks in the PR/notes.

**Verify**: `git log --oneline -5` still shows the FAL/storyboard lineage; no
mass conflict markers.

### Step 3: Run the full verification gate on the ship tip

```sh
npm install
npm run lint && npm test && npm run build
npm run test:package-consumer
```

Run `npm run test:e2e:web` when Docker/Playwright prerequisites match prior
plans (033). If e2e cannot run for environment reasons, record BLOCKED reason
in README but do not invent skips in code.

**Verify**: lint/test/build/package-consumer exit 0.

### Step 4: Point operators at the ship tip; retire the divergent checkout

In `plans/README.md` Round 10 section:

- Set **Ship tip** = this branch's short SHA
- Mark `8125787` / `advisor/export-quality-merge` as **superseded divergent
  checkout — do not execute new plans against it**

Ask the operator before deleting or hard-resetting their local
`advisor/export-quality-merge` branch. Updating a local branch pointer to the
ship tip is allowed **only** with explicit confirmation.

**Verify**: README lists ship tip SHA; `packages/fal-host` present on that SHA.

## Test plan

- No new product tests required beyond the existing full gate.
- Characterization: `rg -n "buildCaptionAss|zoompan|coverCropFilter" apps/worker/src/index.ts`
  still finds the export behaviors on the ship tip.

## Done criteria

- [ ] A branch exists whose tip contains `6287cce` (+ 051/052 if done)
- [ ] `packages/fal-host` exists on that tip
- [ ] Full lint/test/build (+ package-consumer) exit 0
- [ ] README documents the ship tip and marks `8125787` superseded
- [ ] No reckless merge of the 45-commit divergent history
- [ ] No push unless operator requested

## STOP conditions

- Operator insists on merging `8125787` wholesale and conflicts explode across
  `apps/**` — stop; recommend tip-only promotion instead
- Tip gate is red before any integrate change — fix or return to 051/052; do
  not "integrate" a broken tip
- `6287cce` is missing from the local object database and cannot be fetched
- You are about to force-push a shared branch without written operator OK

## Maintenance notes

- All later plans (054+) must stamp and drift-check against this ship tip, not
  `8125787`.
- Deployed remote `advisor/133-design-contract` should eventually fast-forward
  to this tip under normal operator release process (out of scope here).
- Gate 0 legal evidence for FAL remains a production enablement blocker
  independent of tip promotion.
