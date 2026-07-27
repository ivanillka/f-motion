# Plan 006: Harden local-auth and demo identity for hosted safety

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat afd8112..HEAD -- apps/api/src/start.ts apps/api/src/server.ts apps/web/src/main.tsx apps/api/test/auth-routes.test.mjs .env.example docs/runbooks/local-development.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `afd8112`, 2026-07-27

## Why this matters

`FMOTION_LOCAL_AUTH=1` boots `createTestApp`, which injects a fixed owner and
skips JWT verification. `.env.example` ships that flag enabled. The web client,
when `VITE_SUPABASE_URL` is unset, writes `e2e-test-token` and proceeds as
signed-in. Together, a hosted misconfig (copy `.env.example`, build web without
Supabase) is an open or silently broken product. This plan makes local shortcuts
fail-closed outside explicit local/demo modes so later hosted deploy plans are
safe to execute.

## Current state

`apps/api/src/start.ts`:

```ts
if (process.env.FMOTION_LOCAL_AUTH === "1") {
  // ponytail: local-only identity inject. Ceiling: single fixed owner. Upgrade: real Supabase JWT.
  const ownerId = "local-dev";
  …
  createTestApp({ ownerId, projects, renders, media }).listen(port);
} else {
  createApp({ … authConfig … }).listen(port);
}
```

`apps/api/src/server.ts` — `createTestApp` identity inject (no Bearer check):

```ts
return buildApp({ … }, async () => {
  assertAccountActive(accountState);
  return ownerId;
});
```

`apps/web/src/main.tsx` — demo identity:

```ts
if (!supabase) {
  sessionStorage.setItem("fmotion-access-token", "e2e-test-token");
  setToken("e2e-test-token");
  setStep("brief");
  return;
}
```

`.env.example` sets `FMOTION_LOCAL_AUTH=1` with a comment-only warning.

`tests/e2e/web-flow.spec.ts` clicks **Email me a magic link** and relies on the
demo token path against `tests/e2e/run-servers.mjs` (`createTestApp`).

Conventions: AGENTS.md ponytail/YAGNI; conventional commits like
`fix: refuse local auth outside development`. Match auth tests in
`apps/api/test/auth-routes.test.mjs`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npm run lint` | exit 0 |
| API tests | `npm test --workspace apps/api` | exit 0 |
| E2E | `npm run test:e2e:web` | 1 passed |
| Full unit | `npm test` | exit 0 |

## Scope

**In scope**:
- `apps/api/src/start.ts`
- `apps/web/src/main.tsx`
- `apps/api/test/auth-routes.test.mjs` (or a small new start-guard test file imported from `apps/api/test/run.mjs`)
- `.env.example`
- `docs/runbooks/local-development.md` (one short “forbidden on hosted” note)
- `plans/README.md` status

**Out of scope**:
- JWT `User` row provisioning (plan 007)
- Docker/Fly packaging (plan 008)
- Changing `createTestApp` behavior for the e2e harness
- Payments, Gate 0 legal

## Git workflow

- Branch: current `advisor/140-…` or `advisor/145-harden-local-auth`
- Commits: `fix: refuse FMOTION_LOCAL_AUTH outside development`,
  `fix: gate web demo identity to non-production builds`
- Do NOT push unless asked

## Steps

### Step 1: Fail closed when local auth meets production-like env

In `apps/api/src/start.ts`, before booting `createTestApp`:

- If `FMOTION_LOCAL_AUTH === "1"` **and** (`NODE_ENV === "production"` **or**
  `FMOTION_ENV === "hosted"`), throw and exit — do not listen.
- Optional override for break-glass only: require
  `FMOTION_ALLOW_LOCAL_AUTH=1` **and** still refuse when `NODE_ENV=production`
  unless you document why (prefer: never allow in `NODE_ENV=production`).

Keep the local durable stack working when `FMOTION_LOCAL_AUTH=1` and
`NODE_ENV` is unset/`development`.

**Verify**: unit/start test that sets `NODE_ENV=production` +
`FMOTION_LOCAL_AUTH=1` and asserts startup throws (extract a small
`assertLocalAuthAllowed()` pure function if that makes testing easier without
booting Express). `npm test --workspace apps/api` exits 0.

### Step 2: Gate the web demo token

In `apps/web/src/main.tsx` magic-link and Google paths:

- Allow `e2e-test-token` only when `import.meta.env.DEV` is true **or**
  `import.meta.env.VITE_ALLOW_DEMO_AUTH === "1"`.
- Otherwise, if `VITE_SUPABASE_URL` is missing, set a visible error status
  (do not enter the brief step as authenticated).

Ensure `tests/e2e` still works: Vite `dev` is DEV, so e2e stays green without
extra flags. If a production `vite build` preview is used later, it must not
inject the token.

**Verify**: `npm run test:e2e:web` → 1 passed.
`rg -n "e2e-test-token" apps/web/src/main.tsx` still finds the token, but it is
behind the DEV / `VITE_ALLOW_DEMO_AUTH` guard.

### Step 3: Document forbidden production settings

- `.env.example`: keep `FMOTION_LOCAL_AUTH=1` for local copy-paste, but add a
  clear block that hosted/production must **unset** it and set real
  `SUPABASE_*`. Add commented placeholders for `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` (no secret values).
- `docs/runbooks/local-development.md`: one paragraph — never set
  `FMOTION_LOCAL_AUTH` or `VITE_ALLOW_DEMO_AUTH` on a public host.

**Verify**: `rg -n "VITE_SUPABASE_URL" .env.example` → match.
`rg -n "never set|must unset|hosted" docs/runbooks/local-development.md` → match.

## Test plan

| Case | Where |
|------|--------|
| production + local auth refuses | api test |
| development + local auth still allowed (pure function) | api test |
| e2e magic-link still works under Vite DEV | `test:e2e:web` |

Pattern: `apps/api/test/auth-routes.test.mjs`.

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm test --workspace apps/api` exits 0 with new refuse-path test
- [ ] `npm run test:e2e:web` exits 0
- [ ] `NODE_ENV=production FMOTION_LOCAL_AUTH=1` cannot start the API
- [ ] Production web builds without Supabase do not inject `e2e-test-token`
- [ ] No files outside the in-scope list are modified
- [ ] `plans/README.md` 006 → DONE

## STOP conditions

- E2E cannot stay green without permanently enabling demo auth in production
  builds — stop and report rather than weakening the guard.
- Product owner requires local-auth on a public staging URL — stop; that is a
  different threat model and needs an allowlist/IP gate, not this plan.

## Maintenance notes

- Plan 007 makes JWT usable without local auth; land 006 first so staging cannot
  “cheat” with the inject.
- Reviewers: confirm production refuse is hard-fail (exit), not a warning log.
- Deferred: listen-address binding and Express stack-scrubbing error middleware
  (small follow-ups; fold into plan 008 if touching `start.ts` again).
