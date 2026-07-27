# Hosted private deploy

This is a **private, invite-only** demo deploy — not the public/paid Gate 0
launch (see `README.md` Gate 0 checklist). Two processes (API, worker) plus a
statically-hosted web build. Never set `FMOTION_LOCAL_AUTH=1` or
`VITE_ALLOW_DEMO_AUTH=1` on any of them.

## 0. Prerequisites

- `Dockerfile`s: `apps/api/Dockerfile` (Node 24.15.0, no FFmpeg),
  `apps/worker/Dockerfile` (Node 24.15.0 + FFmpeg 8.1.2, static build — see
  the Dockerfile header comment for why apt can't supply it yet).
- Platform config: `fly.api.toml`, `fly.worker.toml` (Fly.io). Any host that
  can run the two container images and inject env vars works instead —
  swap step 5 for that platform's deploy command.

## 1. Provision Postgres (session-mode)

Create a Postgres 17 instance (Supabase Postgres, Fly Postgres, RDS, etc.)
reachable from both the API and worker. **Use a session-mode connection**,
not a transaction-mode pooler (e.g. PgBouncer/Supavisor in transaction
mode): `pg-boss` needs stable, long-lived connections for `LISTEN`-style
leasing and heartbeats. See `docs/decisions/queue.md` — "Supabase
session-mode connections are preferred, while transaction-mode pooling must
be tested before production because listeners and long leases need stable
connections." If your provider only offers transaction-mode pooling, get a
direct/session-mode connection string for `DATABASE_URL` and
`QUEUE_DATABASE_URL` instead of the pooled one.

Record two connection strings (they can point at the same database):

- `DATABASE_URL` — used by the API.
- `QUEUE_DATABASE_URL` — used by the worker (pg-boss).

## 2. Provision object storage (R2 or S3-compatible)

Create a private bucket (Cloudflare R2, S3, MinIO, etc.) and an access key
scoped to it. Record: `R2_ENDPOINT`, `R2_REGION` (use `auto` for R2),
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The bucket must stay
private — the API only ever hands out short-lived signed URLs.

## 3. Create the Supabase project (auth)

1. Create a Supabase project. Enable email magic-link (and Google, if
   wanted) under Authentication.
2. Add the web origin to **Authentication → URL Configuration → Redirect
   URLs** (e.g. `https://app.example.com`).
3. Record: the JWT issuer (`https://<project>.supabase.co/auth/v1`), the
   audience (`authenticated`), and the JWKS URL
   (`https://<project>.supabase.co/auth/v1/.well-known/jwks.json`) — these
   become `SUPABASE_ISSUER`, `SUPABASE_AUDIENCE`, `SUPABASE_JWKS_URL` for the
   API.
4. Record the project URL and anon key for the web build:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## 4. Apply database migrations

```sh
DATABASE_URL=<your-session-mode-url> npx prisma migrate deploy
```

**Known limitation:** `prisma/schema.prisma` currently hardcodes its
`datasource.url` to a local placeholder
(`postgresql://validation:validation@127.0.0.1:5432/fmotion`) instead of
reading `env("DATABASE_URL")`. Prisma CLI ignores environment variables for a
hardcoded literal, so `prisma migrate deploy` will fail authentication
against any real database (local or hosted) until that one line changes.
This file is out of scope for this plan (`plans/008-hosted-deploy-surface.md`
only covers Dockerfiles/`fly.toml`/`start.ts`/docs) — file a follow-up to
change the datasource `url` to `env("DATABASE_URL")` before relying on this
step.

## 5. Deploy the API and worker images

Using Fly.io with the provided configs (first time only needs `fly launch`
to register the app names; already-registered apps just need `fly deploy`):

```sh
fly launch --config fly.api.toml --no-deploy
fly secrets set --config fly.api.toml \
  DATABASE_URL=... SUPABASE_ISSUER=... SUPABASE_AUDIENCE=... SUPABASE_JWKS_URL=... \
  R2_ENDPOINT=... R2_REGION=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  PEXELS_API_KEY=... MEDIA_SIGNING_SECRET=...
fly deploy --config fly.api.toml

fly launch --config fly.worker.toml --no-deploy
fly secrets set --config fly.worker.toml \
  QUEUE_DATABASE_URL=... R2_ENDPOINT=... R2_REGION=... R2_BUCKET=... \
  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
fly deploy --config fly.worker.toml
```

**Do not set `FMOTION_LOCAL_AUTH` as a secret on either app.** The API
refuses to boot with it set when `NODE_ENV=production` or
`FMOTION_ENV=hosted` (`apps/api/src/local-auth.ts`); leaving it unset is the
correct, safest choice on a host regardless.

Any platform that can run `apps/api/Dockerfile` / `apps/worker/Dockerfile`
and inject the same env vars works the same way — swap this step for
`docker build`/`docker run`/your platform's deploy command and keep steps
1–4 and 6–7 unchanged.

## 6. Build and host the web client

```sh
VITE_SUPABASE_URL=https://<project>.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon-key> \
npm run build --workspace apps/web
```

Host `apps/web/dist` on any static host (Fly static, Cloudflare Pages,
Netlify, etc.) that proxies `/api` to the API app's origin. **Do not set
`VITE_ALLOW_DEMO_AUTH`** — its absence plus a production (non-`vite dev`)
build is what disables the local demo identity fallback
(`apps/web/src/main.tsx`).

## 7. Smoke test

```sh
curl -f https://api.example.com/healthz
curl -f https://api.example.com/readyz   # 503 until Postgres is reachable
```

Then, from the hosted web origin: request a magic-link email, follow the
link, create a brief, pick a concept, attach media, render, and download —
end to end through the hosted API/worker/storage/Postgres.

## Required secrets (names only — never commit values)

| Var | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | API | session-mode Postgres |
| `QUEUE_DATABASE_URL` | worker | session-mode Postgres (pg-boss) |
| `R2_ENDPOINT`, `R2_REGION`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | API + worker | private object storage |
| `PEXELS_API_KEY` | API | stock media search |
| `MEDIA_SIGNING_SECRET` | API | upload/download URL signing |
| `SUPABASE_ISSUER`, `SUPABASE_AUDIENCE`, `SUPABASE_JWKS_URL` | API | JWT verification |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | web build | Supabase client |
| `FMOTION_LOCAL_AUTH` | — | must stay **unset** on every hosted process |
| `VITE_ALLOW_DEMO_AUTH` | — | must stay **unset** on every hosted web build |
