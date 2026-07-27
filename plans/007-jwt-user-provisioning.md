# Plan 007: Provision User rows on first verified JWT

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat afd8112..HEAD -- apps/api/src/auth.ts apps/api/src/start.ts apps/api/test/auth-routes.test.mjs prisma/schema.prisma`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/006-harden-local-auth-demo-identity.md (recommended; JWT path must be the hosted default)
- **Category**: security
- **Planned at**: commit `afd8112`, 2026-07-27

## Why this matters

After JWT verify, `authenticateBearer` looks up `"User".state` and treats a
missing row as `"missing"` → 403. The only production code that inserts a
`"User"` is the `FMOTION_LOCAL_AUTH` branch. Real Supabase subjects therefore
cannot use a hosted API unless an operator hand-inserts rows — which pushes
operators back to local auth (plan 006 closes that escape hatch). Hosted
multi-user demo requires automatic, safe provisioning of active accounts on
first successful token.

## Current state

`apps/api/src/auth.ts`:

```ts
const ownerId = payload.sub;
if (!ownerId) throw new UnauthorizedError();
assertAccountActive((await accountState(ownerId)) ?? "missing");
return ownerId;
```

`apps/api/src/start.ts` JWT branch:

```ts
accountState: async (ownerId) => {
  const result = await pool.query<{ state: string }>(
    `SELECT state FROM "User" WHERE id = $1`,
    [ownerId]
  );
  return result.rows[0]?.state;
}
```

Prisma `User` (`prisma/schema.prisma`):

```
model User {
  id                     String
  state                  AccountState @default(active)
  acceptedPolicyVersion  String?
  …
}
```

`assertAccountActive` allows only `state === "active"`; `suspended` /
`deletion_pending` stay forbidden.

Conventions: owner id is always the JWT `sub`. Match
`apps/api/test/auth-routes.test.mjs` JWT route tests (jose + JWKS fixtures).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npm run lint` | exit 0 |
| API tests | `npm test --workspace apps/api` | exit 0 |
| Full unit | `npm test` | exit 0 |

## Scope

**In scope**:
- `apps/api/src/auth.ts` and/or `apps/api/src/start.ts` (provision helper)
- `apps/api/test/auth-routes.test.mjs` (or dedicated auth-provision test)
- `plans/README.md` status

**Out of scope**:
- Full consent / `acceptedPolicyVersion` UX (Gate 0) — leave column null
- Changing JWT verification (issuer/audience/JWKS)
- `FMOTION_LOCAL_AUTH` behavior (plan 006)
- Mobile Flutter auth changes (same API contract)

## Git workflow

- Branch: `advisor/146-jwt-user-provision` or current
- Commits: `feat: provision User on first verified JWT`
- Do NOT push unless asked

## Steps

### Step 1: Define provision-on-first-use policy

Implement the smallest safe rule:

1. After successful `jwtVerify`, load `"User"` by `sub`.
2. If row missing → `INSERT INTO "User" (id, state) VALUES ($1, 'active')
   ON CONFLICT (id) DO NOTHING`, then re-read state.
3. If state is not `active` → keep `AccountUnavailableError` (403).
4. Never flip `suspended` / `deletion_pending` back to `active` via this path.

Prefer putting the upsert next to `accountState` in `start.ts` **or** extending
`authenticateBearer` with an optional `ensureUser` callback — match existing
style; do not invent a new auth framework.

**Verify**: unit/route test with a verified token whose `sub` is absent from
`"User"` → first `/api/projects` (or health-authenticated probe) returns not-403
and a `"User"` row exists afterward. Second request is idempotent.

### Step 2: Cover suspended accounts

Seed a `"User"` with `state = 'suspended'` for a known `sub`. Verified JWT for
that subject must still 403. Do **not** upsert-overwrite state.

**Verify**: existing inactive-account test in `auth-routes.test.mjs` still
passes; add explicit suspended case if missing.

### Step 3: Keep local-auth path unchanged

`FMOTION_LOCAL_AUTH` continues to insert `local-dev` as today (subject to plan
006 guards). JWT provisioning must not run on that path.

**Verify**: `rg -n "createTestApp" apps/api/src/start.ts` still gates local
path; JWT path uses `createApp`.

## Test plan

| Case | Where |
|------|--------|
| unknown sub → active User created | auth-routes / provision test |
| second request no duplicate / still active | same |
| suspended stays 403 | same |
| invalid JWT still 401 (no insert) | existing tests |

Pattern: `apps/api/test/auth-routes.test.mjs` (JWKS fixtures already present).

## Done criteria

- [ ] `npm run lint` / `npm test --workspace apps/api` / `npm test` exit 0
- [ ] First valid JWT for a new `sub` can call an authenticated route without
      manual SQL
- [ ] Suspended users remain forbidden
- [ ] Invalid tokens never insert `"User"` rows
- [ ] `plans/README.md` 007 → DONE

## STOP conditions

- Product requires explicit TOS acceptance (`acceptedPolicyVersion`) before any
  API use — stop and report; that is Gate 0 UX, not silent upsert to `active`.
- Auth tests cannot mint a verified JWT without network JWKS — use the existing
  local JWKS pattern in `auth-routes.test.mjs`; if that pattern is gone, STOP.

## Maintenance notes

- Reviewers: confirm upsert cannot resurrect deleted/suspended accounts.
- Plan 008 hosted runbook should say: first magic-link login creates the User
  row automatically.
- Deferred: email/identity metadata columns; admin invite-only allowlist.
