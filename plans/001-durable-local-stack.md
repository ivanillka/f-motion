# Plan 001: Make the durable Gate 2 stack runnable and documented

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f13f997..HEAD -- README.md docs/runbooks/local-development.md package.json apps/api/package.json apps/worker/package.json apps/api/src/start.ts apps/worker/src/start.ts .env.example .github/workflows/ci.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `f13f997`, 2026-07-27

## Why this matters

`npm run demo` proves the UI against an in-memory `createTestApp` harness. The
production-shaped path (`apps/api/src/start.ts` + `apps/worker/src/start.ts` +
Postgres + S3-compatible storage) exists but cannot be started from documented
commands. Gate 2 media/render work cannot be trusted until that path is one
copy-paste away. The README also contradicts itself (frozen-contract text plus
running-slice text).

## Current state

- `docs/runbooks/local-development.md` — documents a "Fast demo" and a vague
  "Full local stack" without docker/migrate/start commands.
- `apps/api/package.json` — has `build`/`test` only; **no** `start` script.
- `apps/worker/package.json` — has `"start": "node dist/start.js"`.
- `apps/api/src/start.ts` — requires `DATABASE_URL`, `R2_*`, `PEXELS_API_KEY`,
  `SUPABASE_*`, `MEDIA_SIGNING_SECRET` (see file).
- `apps/worker/src/start.ts` — requires `QUEUE_DATABASE_URL`, `R2_*`.
- `.env.example` — placeholders only; no compose file.
- `README.md` — lines 1–30 still claim "No application scaffold…", then the
  split-client/demo section begins (duplicated product description).
- CI (`.github/workflows/ci.yml`) sets `RUN_MEDIA_INTEGRATION=1` and
  `RUN_QUEUE_INTEGRATION=1` but **not** `RUN_PROJECT_INTEGRATION`,
  `RUN_RENDER_INTEGRATION`, or `RUN_WORKER_INTEGRATION` (see
  `apps/api/test/run.mjs` and `apps/worker/test/run.mjs`).

Repo conventions: AGENTS.md ponytail/YAGNI; prefer docker one-liners already
used in CI (`postgres:17-alpine`, `minio/minio`); conventional commits like
`docs: add local operation and CI gates`, `feat: …`.

Do **not** invent Supabase cloud accounts in this plan. For local API auth,
either document a JWKS stub / test issuer that `createApp` can verify, **or**
provide a clearly labeled `FMOTION_LOCAL_AUTH=1` path that uses the existing
`createTestApp` identity inject **only when that env is set**, while still using
Postgres repositories and R2. Prefer the smallest option that keeps production
`createApp` JWT verification unchanged when the env is unset.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `npm ci` | exit 0 |
| Typecheck | `npm run lint` | exit 0 |
| Build | `npm run build` | exit 0 |
| Unit/integration tests | `npm test` | exit 0 (skipped flags OK unless you enable them) |
| Fast UI e2e | `npm run test:e2e:web` | 1 passed |

## Scope

**In scope**:
- `docs/runbooks/local-development.md`
- `README.md` (opening status only — remove contradiction)
- `package.json` (add `stack` or similar script if needed)
- `apps/api/package.json` (add `start`)
- `apps/api/src/start.ts` (only if a minimal local-auth switch is required)
- `.env.example` (document required keys; **no real secrets**)
- `docker-compose.yml` **or** a `scripts/local-deps.sh` that matches CI images
- `.github/workflows/ci.yml` (optionally enable the three missing RUN_* flags)
- `plans/README.md` (status row)

**Out of scope**:
- FAL, payments, Beatoven, Fly deploy, real Supabase production project setup
- Changing the fast `npm run demo` / `tests/e2e/run-servers.mjs` happy path
- Media inspection bytes / FFmpeg media inputs (plans 003–004)
- Android / Flutter

## Git workflow

- Branch: stay on `advisor/140-split-client-no-payments-slice` or create
  `advisor/141-local-stack` from current HEAD if the operator prefers isolation.
- Commits: conventional, e.g. `docs: document durable local stack` /
  `feat: add api start and local compose`.
- Do NOT push or open a PR unless asked.

## Steps

### Step 1: Fix README status contradiction

Rewrite the top of `README.md` so it describes the **current** state: Gate 1
done (Flutter Android + React web), Gate 2 vertical slice in progress on this
branch, Gate 0 still open for public/paid launch. Keep source-of-truth order and
Gate 0 checklist. Remove the false claim that no scaffold may exist.

**Verify**: `rg -n "No application scaffold" README.md` → no matches.
`rg -n "npm run demo" README.md` → at least one match.

### Step 2: Add disposable Postgres + MinIO commands

Add either `docker-compose.yml` or `scripts/local-deps.sh` that starts:

- Postgres 17 with user/password/db `fmotion` / `fmotion` / `fmotion` on `5432`
  (match CI).
- MinIO on `9000` with root user/password suitable for local only; create bucket
  `fmotion-local` (document `mc`/`aws s3 mb` or MinIO console steps).

Update `.env.example` with non-secret local defaults pointing at those services.
Keep placeholder text for Supabase and Pexels keys.

**Verify**: After starting deps,
`docker ps --format '{{.Names}} {{.Ports}}' | rg '5432|9000'` shows listeners.
`pg_isready -h 127.0.0.1 -U fmotion` succeeds (install client or use
`docker exec`).

### Step 3: Migrations + API/worker start scripts

Document:

```sh
npx prisma migrate deploy
# or prisma migrate dev for local — pick one and stick to it
```

Add `"start": "node dist/start.js"` to `apps/api/package.json`.

Add root script e.g. `"stack": "…"` **or** document three terminals:

1. `npm run build --workspace apps/api && npm run start --workspace apps/api`
2. `npm run build --workspace apps/worker && npm run start --workspace apps/worker`
3. `npm run dev --workspace apps/web -- --host 127.0.0.1 --port 4173`

Point Vite proxy at the real API port (`3000` per `API_ORIGIN` / `start.ts`),
**or** document changing `apps/web/vite.config.ts` proxy target for stack mode.
Do not break the e2e proxy to `43140` without updating
`tests/e2e/playwright.config.ts` / `run-servers.mjs`.

If JWT verification blocks local login without Supabase: implement the minimal
`FMOTION_LOCAL_AUTH=1` inject described above, gated so production paths
without that env still require JWKS.

**Verify**: With `.env` loaded and deps up,
`curl -sS http://127.0.0.1:3000/healthz` → `{"status":"ok"}`.
Worker process stays running without immediately exiting.

### Step 4: Rewrite the full-stack section of the runbook

Replace the vague bullets in `docs/runbooks/local-development.md` with the
exact commands from steps 2–3. Keep the Fast demo section. Explicitly state:

- Fast demo = in-memory Gate 2 UI proof (`npm run demo`).
- Full stack = durable Postgres/R2/pg-boss path.

**Verify**: A cold reader can follow the runbook without reading this plan.
`rg -n "docker|prisma migrate|npm run start" docs/runbooks/local-development.md`
shows concrete commands.

### Step 5 (optional but preferred): Enable skipped CI integration flags

In `.github/workflows/ci.yml` `env:`, add:

```yaml
RUN_PROJECT_INTEGRATION: "1"
RUN_RENDER_INTEGRATION: "1"
RUN_WORKER_INTEGRATION: "1"
```

If those tests fail due to missing migrate/bucket setup in CI, fix the CI
bootstrap (migrate + bucket create) rather than disabling the flags again.

**Verify**: Locally,
`RUN_PROJECT_INTEGRATION=1 RUN_RENDER_INTEGRATION=1 RUN_MEDIA_INTEGRATION=1 TEST_DATABASE_URL=… TEST_S3_ENDPOINT=… npm test --workspace apps/api`
and
`RUN_WORKER_INTEGRATION=1 RUN_QUEUE_INTEGRATION=1 TEST_DATABASE_URL=… TEST_S3_ENDPOINT=… npm test --workspace apps/worker`
exit 0 (or STOP with the failing assertion).

## Test plan

- No new unit tests required unless you add `FMOTION_LOCAL_AUTH` — then add one
  API route test proving JWT path still rejects bad tokens when the env is unset,
  modeled after `apps/api/test/auth-routes.test.mjs`.
- Keep `npm run test:e2e:web` green (fast demo unchanged).

## Done criteria

- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run test:e2e:web` exits 0 (1 passed)
- [ ] `rg -n "No application scaffold" README.md` returns nothing
- [ ] Runbook contains copy-paste commands for deps, migrate, api, worker, web
- [ ] `apps/api/package.json` has a `start` script
- [ ] `curl` healthz against the durable API succeeds with local deps
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 001 set to DONE

## STOP conditions

- Durable API cannot authenticate without building a full Supabase project **and**
  a local-auth escape hatch would require redesigning `createApp` broadly —
  stop and report options.
- Prisma migrations fail against Postgres 17 with no obvious SQL fix.
- Enabling CI integration flags reveals failures that need schema redesign
  (report the failing test names; do not delete tests).
- Drift check shows in-scope files diverged from excerpts.

## Maintenance notes

- Reviewers: confirm secrets never enter compose/README; only `.env` (gitignored).
- Follow-ups deferred: real Supabase project docs, Fly deploy, plan 003–004.
- When Vite proxy targets differ between demo and stack, prefer an env-driven
  proxy over two hard-coded ports if both must coexist.
