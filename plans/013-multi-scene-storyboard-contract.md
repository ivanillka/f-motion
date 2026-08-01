# Plan 013: Introduce an authoritative multi-scene storyboard contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. Update `plans/README.md` when complete unless a
> reviewer says they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 425bbd4..HEAD -- packages/contracts packages/reel-engine apps/api/src/domain.ts apps/api/test packages/reel-engine/test apps/mobile/lib/api.dart`
> If an in-scope contract or persistence path changed, compare it with the
> excerpts below and stop on a semantic mismatch.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/012-real-render-journey.md` recommended as a
  verification prerequisite; no runtime dependency
- **Category**: direction / architecture
- **Planned at**: commit `425bbd4`, 2026-08-01

## Why this matters

The production command model can update and reorder scenes but cannot create or
remove them. Selecting any concept creates one three-second scene containing
the entire brief, so the standard path cannot represent setup, development,
reveal, and ending. This plan adds a small, versioned scene lifecycle without
adding a multitrack editor or an AI dependency.

## Current state

- `packages/contracts/src/index.ts:43-49` allows only:

  ```ts
  kind: "select_concept" | "update_scene" | "reorder_scene";
  ```

- `packages/reel-engine/src/index.ts:177-191` initializes exactly one scene:

  ```ts
  const scenes = snapshot.scenes.length ? snapshot.scenes : [{
    id: `${snapshot.id}-scene-1`,
    order: 0,
    caption: snapshot.brief.purpose.trim().slice(0, 180),
    duration_ms: 3000,
    // ...
  }];
  ```

- `apps/api/src/domain.ts:211-245` persists only select, update, and reorder.
  It already runs inside the command transaction and stores full scene JSON in
  `Scene.payload`; no table migration is necessary for an optional scene field.
- `apps/mobile/lib/api.dart:24-26` treats scenes as opaque JSON maps, so adding
  an optional field remains readable by mobile.
- Keep wire `schema_version: 1`. This is an additive command/optional-field
  change; do not claim a breaking v2 contract.
- Match validation style in `packages/reel-engine/src/index.ts:155-171` and
  transaction/idempotency style in `apps/api/src/domain.ts:157-207`.

## Target contract

Add optional `visual_prompt?: string` to `Scene`, trimmed, non-empty when
present, maximum 240 characters. It is a concrete description for media search;
it is not caption text.

Add these command kinds:

- `replace_storyboard`: payload `{ scenes: Scene[] }`, 1–8 scenes, unique IDs,
  contiguous `order` values beginning at zero.
- `add_scene`: payload `{ scene: Scene, at: number }`, unique non-empty ID,
  result capped at eight scenes; normalize every resulting order.
- `remove_scene`: payload `{ scene_id: string }`; the resulting storyboard must
  retain at least one scene.

Existing `update_scene` and `reorder_scene` remain. `select_concept` keeps its
old one-scene initialization temporarily so plan 013 can land without breaking
old web/mobile clients; plan 014 switches the reference web journey to
`replace_storyboard`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Contracts | `npm test --workspace packages/contracts` | exit 0 |
| Engine | `npm test --workspace packages/reel-engine` | exit 0 |
| API | `npm test --workspace apps/api` | exit 0 |
| Typecheck | `npm run lint` | exit 0 |
| Full suite | `npm test` | exit 0 |
| Package boundary | `npm run test:package-consumer` | exit 0 |

## Scope

**In scope**:

- `packages/contracts/src/index.ts`
- `packages/contracts/schema/f-engine-v1.schema.json`
- `packages/contracts/openapi.yaml`
- `packages/contracts/fixtures/*` and `packages/contracts/test/*` as needed
- `packages/reel-engine/src/index.ts`
- `packages/reel-engine/test/engine.test.mjs`
- `apps/api/src/domain.ts`
- `apps/api/test/domain.test.mjs`
- `apps/api/test/project-persistence.test.mjs`
- `apps/mobile/lib/api.dart` only if analyzer changes are required for the
  additive command vocabulary
- `plans/README.md` status

**Out of scope**:

- Web storyboard UI and automatic Pexels searches (plan 014)
- Database schema migrations; scene JSON already lives in `payload`
- AI/LLM story generation
- Caption reading-speed policy, audio tracks, transitions, keyframes, or
  multitrack timelines
- Changing the semantics of existing commands

## Git workflow

- Branch: `advisor/013-multi-scene-storyboard-contract`
- Suggested commits:
  - `feat: add storyboard scene lifecycle commands`
  - `test: persist multi-scene storyboard commands`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Extend and validate the public command vocabulary

Update `Scene` and `CommandEnvelope` in `packages/contracts/src/index.ts`.
Create one shared scene-list validator that enforces:

- one through eight scenes for lifecycle commands;
- unique non-empty IDs;
- contiguous orders matching array positions;
- existing duration, focal, motion, audio, caption, and cue bounds;
- trimmed `visual_prompt`, 1–240 characters when present.

Do not make `visual_prompt` mandatory for historical snapshots. Validate it as
required only for new scenes supplied by `replace_storyboard` and `add_scene`.
Update the JSON Schema and OpenAPI command documentation enough that external
clients can discover the new kinds and limits; do not leave the current
`additionalProperties: true` stub as the only description of these commands.

**Verify**: `npm test --workspace packages/contracts` → exit 0 with new fixture
cases for valid multi-scene data, duplicate IDs, gaps, zero scenes, nine scenes,
and invalid visual prompts.

### Step 2: Implement pure scene lifecycle commands

In `packages/reel-engine/src/index.ts`, extend `applyCommand` with explicit
branches for the three new kinds. Reuse `validatedScene`; do not duplicate
bounds. Normalize `order` after add/remove. Return new arrays and objects; never
mutate the input snapshot. Every successful command increments revision exactly
once.

For `replace_storyboard`, do not preserve media implicitly from a prior scene
whose ID disappeared. The command payload is authoritative. This prevents stale
media from silently attaching to a semantically different beat.

**Verify**: `npm test --workspace packages/reel-engine` → exit 0, including
idempotent input immutability and every boundary listed in the test plan.

### Step 3: Persist lifecycle commands atomically

In `PostgresProjectRepository.persistCommand`, add explicit persistence for
each new command. Because the maximum is eight scenes, use the smallest clear
transactional strategy:

- `replace_storyboard`: delete project scenes, then insert the normalized
  result in order;
- `add_scene` and `remove_scene`: synchronize the resulting eight-or-fewer rows
  in the same command transaction, deleting rows absent from `updated` and
  upserting rows that remain.

Do not interpolate scene IDs into SQL. Keep the existing `CommandReceipt`
idempotency and owner/revision lock unchanged. A duplicate `command_id` must
return the recorded snapshot without applying scene changes twice.

**Verify**: with `TEST_DATABASE_URL` configured,
`npm test --workspace apps/api` → exit 0. The integration test must reopen the
project after replace/add/reorder/remove and compare the full authoritative
snapshot and database row count.

### Step 4: Preserve old clients and package consumers

Confirm existing `select_concept` behavior and mobile JSON parsing still pass.
Do not require plan 014's web UI in this commit. Update contract fixtures and
package-consumer checks for the additive command union.

**Verify**:

```sh
npm run lint
npm test
npm run build
npm run test:package-consumer
flutter analyze apps/mobile
cd apps/mobile && flutter test
```

Expected: every command exits 0.

## Test plan

- Replace with 1, 4, and 8 scenes succeeds; 0 and 9 fail.
- Duplicate IDs and noncontiguous orders fail.
- Add at beginning, middle, and end normalizes order.
- Adding a ninth scene fails.
- Remove normalizes order; removing the last scene fails.
- Unknown scene remove/reorder/update fails.
- `visual_prompt` trim/length boundaries are covered.
- Stale revision and duplicate `command_id` behavior remain unchanged.
- PostgreSQL rows exactly match the returned snapshot after each lifecycle
  command and rollback cleanly on failure.

## Done criteria

- [ ] Public contracts describe all three lifecycle commands and
      `visual_prompt`.
- [ ] The engine supports 1–8 authoritative scenes without mutating inputs.
- [ ] PostgreSQL persistence is atomic and idempotent.
- [ ] Historical snapshots without `visual_prompt` remain valid.
- [ ] Existing select/update/reorder behavior remains green.
- [ ] Full Node, package-consumer, and Flutter gates exit 0.
- [ ] Only in-scope files changed.
- [ ] Plan 013 is marked DONE in `plans/README.md`.

## STOP conditions

- Stop if a true schema-version bump is required; report the migration and
  compatibility work instead of silently changing `schema_version`.
- Stop if lifecycle persistence cannot remain in the existing command
  transaction.
- Stop if an existing client depends on rejecting unknown additive scene
  properties rather than ignoring them.
- Stop if implementing this appears to require AI-generated text; this plan is
  only the deterministic model and command boundary.
- Stop after two failed attempts at a verification step.

## Maintenance notes

- Eight scenes is a deliberate private-demo ceiling. Raise it only with render
  capacity and editor usability evidence.
- `visual_prompt` belongs to host/provider selection; the neutral renderer
  ignores it.
- Plan 014 is responsible for switching the web journey to this model and for
  creating/editing concrete beat descriptions.
