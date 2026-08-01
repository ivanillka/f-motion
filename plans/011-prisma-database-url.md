# Plan 011: Point Prisma datasource at DATABASE_URL

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 12dee30..HEAD -- prisma/schema.prisma .github/workflows/ci.yml docs/runbooks/hosted-deploy.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/008-hosted-deploy-surface.md
- **Category**: dx / bug
- **Planned at**: commit `12dee30`, 2026-07-27
- **Issue**: (none)

## Why this matters

Plan 008 discovered that `prisma/schema.prisma` hardcodes
`datasource.url` to a local validation placeholder. Prisma CLI then ignores
`DATABASE_URL`, so `npx prisma migrate deploy` cannot target CI Postgres,
local MinIO stack DB, or hosted Postgres. Hosted deploy step 4 is blocked
until this lands.

## Current state (pre-fix)

```prisma
datasource db {
  provider = "postgresql"
  // ponytail: validation uses a non-routable local placeholder; …
  url      = "postgresql://validation:validation@127.0.0.1:5432/fmotion"
}
```

CI (`.github/workflows/ci.yml`) sets `TEST_DATABASE_URL` but not
`DATABASE_URL`, then runs `npx prisma migrate deploy`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Validate | `DATABASE_URL=postgresql://fmotion:fmotion@127.0.0.1:5432/fmotion npx prisma validate` | schema valid |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**:
- `prisma/schema.prisma`
- `.github/workflows/ci.yml` (set `DATABASE_URL` for migrate/validate)
- `docs/runbooks/hosted-deploy.md` (remove known-limitation paragraph)
- `plans/README.md` status

**Out of scope**: changing migration SQL; Dockerfiles; auth.

## Steps

1. Change `url` to `env("DATABASE_URL")`; drop the validation-placeholder comment.
2. Add `DATABASE_URL: postgresql://fmotion:fmotion@127.0.0.1:5432/fmotion` to CI `env:` (same as service Postgres).
3. Remove the "Known limitation" block from `docs/runbooks/hosted-deploy.md` §4; note that schema reads `DATABASE_URL`.

**Verify**: `DATABASE_URL=… npx prisma validate` exits 0 / valid.
`rg -n 'validation:validation' prisma/` → no matches.

## Done criteria

- [ ] `url = env("DATABASE_URL")` in schema
- [ ] CI exports `DATABASE_URL`
- [ ] Hosted runbook no longer claims hardcoded URL
- [ ] `prisma validate` succeeds with `DATABASE_URL` set

## STOP conditions

- Something in the repo requires the literal URL for `prisma generate` without
  env and cannot be fixed by documenting `.env` / CI env — stop and report.
