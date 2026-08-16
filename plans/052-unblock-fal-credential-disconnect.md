# Plan 052: Unblock FAL credential disconnect after generation jobs exist

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. When done, update
> the status row for this plan in `plans/README.md` unless a reviewer maintains
> the index.
>
> **Target baseline**: tip containing plans 048–050, preferably after plan 051
> (`6287cce` or descendant).
>
> **Drift check (run first)**:
> `git diff --stat 6287cce..HEAD -- prisma/schema.prisma apps/api/src/fal-credentials.ts apps/api/test/fal-credentials.test.mjs apps/api/test/fal-credentials-integration.test.mjs packages/fal-host/src/index.ts`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans 048–050; **preferred** plan 051 (so cancel clears active slots before disconnect)
- **Category**: security
- **Planned at**: commit `6287cce`, 2026-08-02

## Why this matters

BYOK requires that an owner can revoke the stored FAL API key. Today
`GenerationJob.credentialId` uses `onDelete: Restrict` and disconnect
`DELETE`s the `ProviderCredential` row. After **any** generation job exists
(even terminal), Postgres rejects the delete — the owner cannot disconnect.
That is a trust-boundary failure: leaked or unwanted keys must be removable.

## Current state

Schema:

```210:218:prisma/schema.prisma
model GenerationJob {
  ...
  credentialId      String
  credential        ProviderCredential @relation(fields: [credentialId], references: [id], onDelete: Restrict)
```

Disconnect:

```171:178:apps/api/src/fal-credentials.ts
  async disconnect(ownerId: string): Promise<void> {
    ...
      await assertNoActiveFalGeneration(client, ownerId);
      await client.query(
        `DELETE FROM "ProviderCredential" WHERE "ownerId" = $1 AND provider = 'fal'`,
```

`assertNoActiveFalGeneration` only blocks **active** jobs — terminal history is
enough to trip Restrict.

Credential views never return ciphertext (good). Keep that.

Existing tests: `apps/api/test/fal-credentials.test.mjs` and
`fal-credentials-integration.test.mjs` cover connect/test/delete **without**
generation rows.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Lint | `npm run lint` | exit 0 |
| Credential tests | `npm test --workspace apps/api -- fal-credentials` | all pass |
| Generation tests | `npm test --workspace apps/api -- fal-generation` | all pass |
| Full gate | `npm run lint && npm test && npm run build` | exit 0 |

If the repo uses Prisma migrate for schema changes, also run the project's
documented migrate/generate path used by prior FAL migrations (see
`prisma/migrations/` for `fal_*` examples). Do not invent a second migration
tool.

## Scope

**In scope**:

- `prisma/schema.prisma`
- New Prisma migration under `prisma/migrations/` (SQL that matches schema)
- `apps/api/src/fal-credentials.ts` (and raw SQL callers if they assume non-null FK)
- Any GenerationJob load/SQL that assumes credential always exists after
  disconnect — adjust decrypt paths to treat missing credential as
  `fal_not_connected` / fail the job, never resurrect a key
- Tests: `apps/api/test/fal-credentials*.mjs`, extend
  `fal-generation.test.mjs` if confirm after disconnect must 409
- `plans/README.md` status

**Out of scope**:

- Returning raw keys to the browser
- Soft-delete UI beyond existing Settings disconnect
- Rotating KEKs / loading prior `FENGINE_CREDENTIAL_KEY_V*` versions (deferred)
- Deleting historical `GenerationJob` rows
- Changing Pexels credential schema unless it shares the exact same Restrict
  bug **and** the same delete path — only touch Pexels if identical and tests
  already cover it; otherwise leave Pexels alone

## Git workflow

- Branch: `advisor/052-unblock-fal-credential-disconnect` from tip after 051
  when available
- Isolated worktree preferred
- Commit: `fix: allow FAL disconnect after generation history` (+ migration)
- Do NOT push unless asked

## Steps

### Step 1: Make historical jobs survive credential deletion

Chosen approach (do not invent a tombstone table):

1. Make `GenerationJob.credentialId` **nullable** (`String?`).
2. Change relation to `onDelete: SetNull`.
3. Migration SQL: drop Restrict FK, alter column nullable, re-add FK
   `ON DELETE SET NULL`.
4. Keep `assertNoActiveFalGeneration` before DELETE so in-flight jobs still
   block disconnect (409 busy). After 051, cancel can clear that block.

Update any TypeScript that assumes `credentialId: string` on job rows used
only for decrypt-during-worker: workers already join credential columns for
active jobs; a disconnected owner should have no active jobs.

**Verify**: `npx prisma validate` (or the repo's equivalent) succeeds; migration
folder contains forward SQL only (no secret values).

### Step 2: Disconnect remains transactional and busy-safe

Keep:

```text
BEGIN → assertNoActiveFalGeneration → DELETE ProviderCredential → COMMIT
```

After migration, DELETE must succeed when only terminal (or no) generation
jobs exist. Map Prisma/pg FK errors must not surface as 500 if a race creates
an active job — rely on the assert + busy error mapping already in
`falCredentialHttpError`.

**Verify**: unit/integration test:
1. Connect FAL (mocked validate as existing tests).
2. Insert or create a **terminal** `GenerationJob` referencing the credential
   (state `ready` or `failed`).
3. `DELETE /api/providers/fal/credential` → **204**.
4. `GET` credential → `{ connected: false }`.
5. Active job still → **409** `fal_credential_busy` (or existing busy type).

### Step 3: Fail closed if work still references a removed key

Confirm and worker decrypt paths: if credential row is gone, respond with
existing `fal_not_connected` / fail the job — never read env `FAL_KEY`.

**Verify**: generation confirm without credential → 409 `fal_not_connected`.
Existing "no shared FAL in hosted" asserts remain green.

### Step 4: Full gate

```sh
npm run lint && npm test && npm run build
```
→ exit 0; update README row 052.

## Test plan

- Disconnect with terminal generation history → 204 (new)
- Disconnect with active generation → busy error (existing + keep)
- Confirm after disconnect → not_connected (new or extend)
- Model after `apps/api/test/fal-credentials-integration.test.mjs` when a real
  Postgres is available; otherwise extend the in-memory/fake server test module
  the API suite already uses for credentials

## Done criteria

- [ ] `GenerationJob.credentialId` nullable with `ON DELETE SET NULL`
- [ ] Owner can disconnect after terminal generation jobs exist
- [ ] Active generation still blocks disconnect
- [ ] No plaintext credential in responses or logs
- [ ] Full lint/test/build exit 0
- [ ] Only in-scope files changed; README updated

## STOP conditions

- Drift vs excerpts
- Migration would destroy ciphertext without a delete path the owner controls
- You believe soft-tombstone (keep row, wipe ciphertext) is required for audit
  compliance beyond SetNull — STOP and report; do not implement both
- Fix appears to need deleting all GenerationJob history

## Maintenance notes

- Reviewers: confirm OpenAPI/error docs still describe busy vs not_connected.
- Follow-up (not this plan): `credentialVaultFromEnv` should load prior KEK
  versions so rotation does not break decrypt of rows still keyed at `keyVersion`.
- Plan 053 promote tip should include this migration before production deploy.
