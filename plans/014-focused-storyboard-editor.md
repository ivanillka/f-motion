# Plan 014: Ship a focused multi-scene storyboard editor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> on any condition in "STOP conditions"; do not improvise. Update the plan row
> in `plans/README.md` when done unless a reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 425bbd4..HEAD -- apps/web/src apps/web/test tests/e2e apps/api/src/server.ts apps/api/src/media-storage.ts apps/api/test docs/design/ACCEPTANCE.md`
> Plan 013 is expected to change contracts and the engine. Stop only when live
> behavior does not match plan 013's completed lifecycle contract.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/012-real-render-journey.md`,
  `plans/013-multi-scene-storyboard-contract.md`
- **Category**: direction / product
- **Planned at**: commit `425bbd4`, 2026-08-01

## Why this matters

The current editor controls only `scenes[0]`, shows one still thumbnail, and
automatically accepts one Pexels result. Users cannot shape a story or correct a
wrong visual without restarting the whole brief. This plan supplies the
smallest useful in-app editor: scene cards, concrete visual prompts, candidate
choice, caption/duration/crop/motion controls, and accessible ordering.

## Current state

- `apps/web/src/main.tsx:169-186` always initializes concept `direct`.
- `apps/web/src/main.tsx:204-227` calls `/media/pexels/auto` and labels the first
  result as selected.
- `apps/web/src/main.tsx:267-315` saves and attaches only `scenes[0]`.
- `apps/web/src/main.tsx:530-550` renders one preview card and two editable
  fields.
- The API already exposes candidate search and explicit selection at
  `apps/api/src/server.ts:273-323`; reuse it instead of adding another provider
  route.
- `loadSceneMediaViews` in `apps/web/src/api.ts:118-126` already hydrates a map
  for every unique scene media ID. Preserve its replace-not-merge behavior.
- Accepted design intent includes storyboard editor and crop screens at
  `docs/design/ACCEPTANCE.md:69-80`, but generated HTML is reference data only.
- Match the current React functional-component and plain CSS conventions. Do
  not introduce a state library, component system, router, or drag-and-drop
  dependency.

## Target first-release experience

On brief submission, create an editable four-beat storyboard. The reference
host is deterministic and must not pretend to perform semantic AI planning:

1. Split the brief on sentence boundaries and substantial comma/semicolon
   clauses (trimmed fragments of at least 12 characters), capped at six.
2. If at least three fragments exist, create one beat per fragment.
3. Otherwise create four roles — Establish, Develop, Reveal, Close — using the
   whole brief plus a visible role suffix in `visual_prompt`:
   `wide establishing view`, `closer environmental detail`,
   `key reveal or change`, `closing wide shot`.
4. Divide the original words contiguously across the resulting beat captions;
   never repeat the full caption in every scene. Empty caption is allowed when
   there are fewer words than beats.
5. Default each scene to 3 seconds, centered focal point, no motion, audio 1.

The user sees and can edit these prompts before any stock copy. Each scene
search shows up to three candidate previews and attribution. Media is attached
only after explicit selection and worker inspection.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Web unit | `npm test --workspace apps/web` | exit 0 |
| API unit/integration | `npm test --workspace apps/api` | exit 0 |
| Browser E2E | `npm run test:e2e:web` | exit 0 |
| Typecheck | `npm run lint` | exit 0 |
| Full suite | `npm test` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/main.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/style.css`
- One focused component file such as `apps/web/src/storyboard-editor.tsx` if
  keeping all scene UI in `main.tsx` would make it harder to test
- `apps/web/test/api.test.mjs`, `apps/web/test/web.test.mjs`, and additional
  focused web tests
- `tests/e2e/run-servers.mjs`, `tests/e2e/web-flow.spec.ts`
- `apps/api/src/server.ts` and API tests only for a missing owner-scoped response
  needed by the existing explicit Pexels-selection route
- `plans/README.md` status

**Out of scope**:

- Accurate rendered proxy and final/preview job semantics (plans 015–016)
- AI-generated storyboards or semantic embeddings
- Drag-and-drop, a multitrack timeline, transitions, keyframes, filters, color
  grading, voice-over, or music
- New provider dependencies
- Automatic acceptance of a Pexels candidate

## Git workflow

- Branch: `advisor/014-focused-storyboard-editor`
- Suggested commits:
  - `feat: initialize editable multi-scene storyboards`
  - `feat: choose media and edit every storyboard scene`
  - `test: cover the multi-scene web journey`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add deterministic storyboard-draft helpers

Add pure functions in `apps/web/src/api.ts` (or one small adjacent module if
typing becomes awkward) for clause splitting, contiguous caption-word
apportionment, and four-role fallback. Accept a `makeId` callback so tests can
produce stable IDs while production passes `crypto.randomUUID`.

Return valid plan-013 `Scene` objects with concrete `visual_prompt`. Keep every
rule listed under "Target first-release experience" explicit and tested. Do not
call Pexels from this helper.

**Verify**: `npm test --workspace apps/web` → exit 0 with exact fixtures for a
four-clause mystery brief, a one-sentence brief, Unicode text, excess clauses,
and very short text.

### Step 2: Switch project preparation to the storyboard command

Track a local `createdNow` boolean in `prepareProject`. Only during that same
new-project transaction flow, after concept selection, call plan 013's
`replace_storyboard` once with the deterministic draft. Never infer eligibility
from "one scene" shape: an intentionally edited historical one-scene project
must remain one scene when reopened. Preserve local draft recovery and
stale-revision conflict behavior.

Replace every `scenes[0]` assumption in new-project preparation, media attach,
save, and active preview selection with an explicit `activeSceneId`. If a
deleted scene was active, select the nearest remaining scene.

**Verify**:

```sh
rg -n 'scenes\[0\]' apps/web/src/main.tsx apps/web/src/storyboard-editor.tsx
```

Expected: no mutation or media-attachment logic uses `scenes[0]`; a read-only
fallback for selecting the first ordered scene is acceptable when documented.
Run `npm test --workspace apps/web` → exit 0.

### Step 3: Build accessible scene navigation and editing

Render ordered scene cards with:

- scene number/role and thumbnail or clear missing-media state;
- editable `visual_prompt` and caption;
- duration input bounded by the engine (0.5–15 seconds);
- motion select;
- focal X/Y range inputs with labels and numeric value;
- source audio level/mute control using existing `audio_level` semantics;
- Move earlier, Move later, Add scene, and Remove scene buttons.

Use buttons rather than drag-only ordering. All controls need programmatic
labels containing the scene number. Save through authoritative commands and
surface stale conflicts; never optimistic-merge a rejected command.

Do not expose `ducking`; it is documented as unused until a licensed music bed
exists.

**Verify**: web tests exercise add, remove, reorder, edit, keyboard focus, and
disabled boundary controls. `npm run lint` → exit 0.

### Step 4: Replace first-result auto-match with per-scene candidate choice

For the active scene, call the existing candidate-search endpoint using its
`visual_prompt`. Display at most three portrait candidates with preview,
creator, Pexels link, and a Select button. Do not label any candidate "best"
unless a future ranking contract supplies measured confidence.

When selected, use the existing explicit Pexels copy endpoint, poll the
owner-scoped asset state, and attach only when `ready`. Preserve attribution in
the scene card. Bound search UI to one in-flight request per scene, cancel stale
responses with `AbortController`, and report provider failure without losing
edits.

Upload must also target `activeSceneId`, not scene zero. Track the intended
scene across inspection; if that scene was deleted before readiness, do not
attach the asset to another scene.

**Verify**: deterministic E2E fixtures return a deliberately wrong first
candidate and a correct second candidate. The test selects the second and
asserts the attached attribution/media ID belongs only to the active scene.

### Step 5: Upgrade the browser journey to multiple scenes

Extend plan 012's real render journey to create at least four scenes, select
different deterministic fixture candidates for at least two scenes, reorder
one scene, and render the actual snapshot. Assert the probed duration equals
the sum of ordered scene durations within tolerance and is not one source clip
duration.

Do not use the real Pexels network. Keep fixtures small and existing.

**Verify**: `npm run test:e2e:web` → exit 0; reverting the scene iteration to
`scenes[0]` causes a deterministic assertion failure.

### Step 6: Run repository gates

```sh
npm run lint
npm test
npm run build
npm run test:package-consumer
npm run test:e2e:web
flutter analyze apps/mobile
cd apps/mobile && flutter test
```

Expected: every command exits 0.

## Test plan

- Brief segmentation and four-role fallback are deterministic.
- Existing multi-scene drafts are never replaced on open.
- Add/remove/reorder/edit commands preserve authoritative revision ordering.
- Every scene can independently select/upload/replace media.
- Stale search/inspection responses cannot attach to another scene.
- Candidate two can be selected when candidate one is wrong.
- Buttons and inputs have scene-specific accessible names.
- E2E MP4 duration equals the full ordered storyboard.

## Done criteria

- [ ] New projects present an editable 3–6 scene storyboard (four for a
      one-sentence brief).
- [ ] No media is automatically accepted as the "best" candidate.
- [ ] Every scene can be edited, reordered, added, removed, and assigned media.
- [ ] Upload and Pexels inspection attach to the intended scene only.
- [ ] The browser E2E renders multiple real scenes and asserts total duration.
- [ ] All Node, browser, package, and Flutter gates exit 0.
- [ ] Only in-scope files changed.
- [ ] Plan 014 is marked DONE in `plans/README.md`.

## STOP conditions

- Stop if plan 013 is not complete or its command shapes differ.
- Stop if the existing explicit Pexels endpoint exposes source URLs to the
  browser; correct the response boundary before using it.
- Stop if an accurate preview is required to implement the editor controls;
  keep this plan's composition preview approximate and leave proxy work to 015.
- Stop if requirements expand into multitrack editing or AI generation.
- Stop after two failed attempts at any verification step.

## Maintenance notes

- This editor is intentionally storyboard-first. External NLEs own advanced
  editing after plan 017 export.
- Review every new `useEffect` for stale async writes; use active scene and
  request-generation IDs consistently.
- Any later automatic planner must output the same validated scene command and
  remain host-owned, not embedded into the neutral renderer.
