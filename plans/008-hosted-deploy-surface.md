# Plan 008: Ship a private hosted deploy surface (API + worker + web)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat afd8112..HEAD -- apps/api/src/start.ts apps/worker/src/start.ts docs/runbooks package.json .github/workflows/ci.yml .env.example`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/006-harden-local-auth-demo-identity.md, plans/007-jwt-user-provisioning.md
- **Category**: dx / docs / direction
- **Planned at**: commit `afd8112`, 2026-07-27

## Why this matters

The repo can run `npm run demo` and a documented local Postgres/MinIO stack, but
there is **no** `Dockerfile`, **no** `fly.toml` (or equivalent), and **no** hosted
runbook. A private invite-only demo cannot be reproduced from the tree.
`docs/runbooks/render-worker.md` requires FFmpeg **only** in the worker — the
API must not gain a render fallback. This plan adds the minimum packaging +
operator docs for a private hosted slice (not public/paid Gate 0 launch).

## Current state

- No `Dockerfile*`, no `fly.toml`, no `docker-compose.yml` at repo root.
- API entry: `apps/api` → `"start": "node dist/start.js"` (`apps/api/package.json`).
- Worker entry: `apps/worker/src/start.ts` → `startQueueRuntime(...)` (needs
  `QUEUE_DATABASE_URL`, `R2_*`).
- `/readyz` always succeeds unless a `ready` callback is passed
  (`apps/api/src/server.ts` defaults `ready ?? (() => true)`; `start.ts` does
  not pass one).
- Local runbook: `docs/runbooks/local-development.md` only.
- Plan 001 explicitly deferred Fly deploy.

Toolchain (README): Node **24.15.0**, FFmpeg **8.1.2** on the worker image.

Conventions: AGENTS.md — prefer smallest direct implementation; do not invent
payments/FAL/music. Secrets only via platform env — never commit values.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npm run lint` | exit 0 |
| Tests | `npm test` | exit 0 |
| E2E | `npm run test:e2e:web` | 1 passed |
| Image build (local) | `docker build …` | exit 0 (if Docker available) |

## Scope

**In scope**:
- `Dockerfile` and/or `apps/api/Dockerfile` + `apps/worker/Dockerfile` (choose the
  smallest monorepo-friendly layout; document it)
- `fly.toml` **or** equivalent platform config for **api** and **worker**
  (two processes). If Fly is unavailable to the executor, still land Dockerfiles
  + a platform-agnostic runbook and mark Fly-specific verify BLOCKED.
- `docs/runbooks/hosted-deploy.md` (new)
- `apps/api/src/start.ts` — pass a real `ready` callback (DB `SELECT 1`);
  optional `LISTEN_HOST` bind (default `0.0.0.0` behind platform proxy is OK if
  documented; prefer explicit env)
- `.env.example` — production checklist comments (no secrets)
- `README.md` — one link to the hosted runbook
- `plans/README.md` status

**Out of scope**:
- CI auto-deploy to production (manual `fly deploy` / image push is enough)
- Public Gate 0 legal checklist completion
- Payments, Beatoven, managed FAL
- Android Play signing
- Changing the fast `npm run demo` path

## Git workflow

- Branch: `advisor/147-hosted-deploy` or current
- Commits: `feat: add api and worker container images`,
  `docs: add hosted private deploy runbook`,
  `fix: wire /readyz to database`
- Do NOT push unless asked

## Steps

### Step 1: Wire `/readyz` to Postgres

In `apps/api/src/start.ts`, when calling `createApp` / `createTestApp`, pass:

```ts
ready: async () => {
  await pool.query("SELECT 1");
  return true;
}
```

(Adjust `createTestApp` / `buildApp` if `ready` today is sync-only — make it
accept `boolean | Promise<boolean>` if needed.) Keep `/healthz` as process-alive
only.

**Verify**: unit or small test that a failing `ready` yields HTTP 503 on
`/readyz`. `npm test --workspace apps/api` exits 0.

### Step 2: Add worker + API Dockerfiles

Minimum requirements:

- **API image**: Node 24.15.0, `npm ci` (or workspace install), build workspaces
  needed by API, `CMD` → `node apps/api/dist/start.js` (or package start).
- **Worker image**: same Node base **plus** FFmpeg **8.1.x** (document package
  source), build worker + contracts/reel-engine, `CMD` → worker start.
- Do **not** install FFmpeg in the API image.

Use multi-stage builds if cheap; avoid copying `.env` into images.

**Verify**: `docker build` for each image exits 0 when Docker is available.
If Docker is unavailable (same class of failure as plan 001), complete the
Dockerfiles, mark image-build verify BLOCKED in the plan status note, and
continue with the runbook.

### Step 3: Platform process config

Add `fly.toml` (or documented equivalent) defining:

1. **api** service — HTTP on `PORT`, health check `/healthz`, readiness
   `/readyz` if the platform supports it.
2. **worker** process — no public HTTP; same secrets for DB/R2; scale ≥1.

Document required secrets by **name only** (types): `DATABASE_URL`,
`QUEUE_DATABASE_URL`, `R2_*`, `PEXELS_API_KEY`, `SUPABASE_*`, and that
`FMOTION_LOCAL_AUTH` must be **unset**. Web is a static Vite build hosted
separately (Fly static, Cloudflare Pages, etc.) with `VITE_SUPABASE_*` and API
origin.

**Verify**: config files parse / are present; runbook lists both processes.

### Step 4: Write `docs/runbooks/hosted-deploy.md`

Copy-paste operator order:

1. Provision Postgres (session mode for pg-boss — cite `docs/decisions/queue.md`).
2. Provision R2/S3 bucket + API keys.
3. Create Supabase project; set issuer/audience/JWKS; set Vite anon URL/key;
   allow redirect URLs for the web origin.
4. `npx prisma migrate deploy` against hosted DB.
5. Deploy API + worker images; unset `FMOTION_LOCAL_AUTH`.
6. Build/host web with Supabase env (no `VITE_ALLOW_DEMO_AUTH`).
7. Smoke: `/healthz`, `/readyz`, magic-link sign-in, one brief → concept →
   render → download.

Link from `README.md`.

**Verify**: `rg -n "FMOTION_LOCAL_AUTH|prisma migrate|/readyz" docs/runbooks/hosted-deploy.md`
shows concrete commands. Cold reader can follow without this plan.

## Test plan

| Case | Where |
|------|--------|
| `/readyz` 503 when DB check fails | api test |
| Dockerfiles exist and build (if Docker) | local docker |
| Runbook references required env names | rg |

No need to actually deploy to Fly from CI in this plan.

## Done criteria

- [ ] `npm run lint` / `npm test` / `npm run test:e2e:web` exit 0
- [ ] `/readyz` reflects DB availability
- [ ] API and worker Dockerfiles exist; worker includes FFmpeg; API does not
- [ ] `docs/runbooks/hosted-deploy.md` exists and is linked from README
- [ ] Platform config for api+worker exists **or** BLOCKED note with Docker-only
      deliverable + why Fly files were skipped
- [ ] `plans/README.md` 008 → DONE (or DONE with BLOCKED verify note)

## STOP conditions

- FFmpeg cannot be installed in the chosen base image at 8.1.x — stop and report
  alternate base images; do not silently drop to a different major without
  updating README toolchain.
- Platform forces transaction-mode Postgres pooling that breaks pg-boss —
  stop and cite `docs/decisions/queue.md`; do not invent a second queue.
- Plans 006/007 not DONE — do not document “just set local auth on Fly”.

## Maintenance notes

- Reviewers: two processes; secrets never in git; local-auth forbidden on host.
- Follow-ups: CI `workflow_dispatch` deploy; CDN for web; autoscaling worker.
- Plans 009–010 improve reliability/trust once something is actually hosted.
