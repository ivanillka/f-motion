# Hosted private deploy

This is a **private, invite-only** demo deploy — not the public/paid Gate 0
launch (see `README.md` Gate 0 checklist). Two processes (API, worker) plus a
statically-hosted web build. Never set `FENGINE_LOCAL_AUTH=1` or
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

### CORS (required for browser uploads)

The web client uploads with a browser `PUT` straight to the presigned
object-storage URL. That request is **cross-origin** (web app origin → bucket
host), so the bucket must allow CORS for the **hosted web origin** (e.g.
`https://app.example.com`).

Configure bucket CORS with at least:

- **Allowed origins**: your web app origin (not `*` in production unless you
  accept the risk on a private demo).
- **Allowed methods**: `PUT`, `GET`, `HEAD` (`GET` for signed download URLs).
- **Allowed headers**: `Content-Type` (the client sends the file's MIME type
  on upload). `*` is acceptable for a private demo bucket.

**Cloudflare R2** (dashboard → bucket → Settings → CORS policy) or API — example
JSON shape:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

**S3-compatible** (AWS CLI or any store that accepts the S3 CORS API):

```sh
aws s3api put-bucket-cors --bucket <your-bucket> --endpoint-url <R2_ENDPOINT> \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedOrigins": ["https://app.example.com"],
      "AllowedMethods": ["PUT", "GET", "HEAD"],
      "AllowedHeaders": ["Content-Type"],
      "MaxAgeSeconds": 3600
    }]
  }'
```

Replace `<your-bucket>`, `<R2_ENDPOINT>`, and the origin with your values. CORS
lives on the **bucket**, not the API.

## 3. Create the Supabase project (auth)

1. Create a Supabase project. Enable email magic-link (and Google, if
   wanted) under Authentication.
2. Set **Authentication → URL Configuration → Site URL** to the canonical web
   origin and add its slash-terminated callback to **Redirect URLs** (for
   example `https://app.example.com/`). The web client uses Supabase PKCE and
   returns to that root URL.
3. Record: the JWT issuer (`https://<project>.supabase.co/auth/v1`), the
   audience (`authenticated`), and the JWKS URL
   (`https://<project>.supabase.co/auth/v1/.well-known/jwks.json`) — these
   become `SUPABASE_ISSUER`, `SUPABASE_AUDIENCE`, `SUPABASE_JWKS_URL` for the
   API.
4. Record the project URL and anon key for the web build:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   This must be the public browser key, never a service-role key.
5. In **Authentication → Providers → Email**, disable new-user sign-ups for
   this private demo. Existing invited users can still request magic links.
6. In **Authentication → Users**, copy each invited user's UUID. The API
   compares the verified JWT `sub` to UUIDs; email addresses are not accepted.
7. If Google is enabled, configure the Google provider and its Supabase
   callback first, then build the web client with
   `VITE_ENABLE_GOOGLE_AUTH=1`. Leave the flag unset for email-only auth.

Disabling Supabase sign-up is defense in depth, not application access
control. The API must also use `FENGINE_ACCESS_MODE=invite_only` with a
non-empty `FENGINE_ALLOWED_USER_IDS` list.

## 4. Apply database migrations

```sh
DATABASE_URL=<your-session-mode-url> npx prisma migrate deploy
```

`prisma/schema.prisma` reads `env("DATABASE_URL")`. CI and local stack must
export the same variable (see `.env.example` and `.github/workflows/ci.yml`).

## 5. Deploy the API and worker images

Using Fly.io with the provided configs (first time only needs `fly launch`
to register the app names; already-registered apps just need `fly deploy`):

```sh
fly launch --config fly.api.toml --no-deploy
fly secrets set --config fly.api.toml \
  DATABASE_URL=... SUPABASE_ISSUER=... SUPABASE_AUDIENCE=... SUPABASE_JWKS_URL=... \
  R2_ENDPOINT=... R2_REGION=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  PEXELS_API_KEY=... FENGINE_ACCESS_MODE=invite_only \
  FENGINE_ALLOWED_USER_IDS=<comma-separated-supabase-user-uuids>
fly deploy --config fly.api.toml

fly launch --config fly.worker.toml --no-deploy
fly secrets set --config fly.worker.toml \
  QUEUE_DATABASE_URL=... R2_ENDPOINT=... R2_REGION=... R2_BUCKET=... \
  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...
fly deploy --config fly.worker.toml
```

**Do not set `FENGINE_LOCAL_AUTH` as a secret on either app.** The API
refuses to boot with it set when `NODE_ENV=production` or
`FENGINE_ENV=hosted` (`apps/api/src/local-auth.ts`); leaving it unset is the
correct, safest choice on a host regardless.

`fly.api.toml` sets `FENGINE_ENV=hosted` in `[env]` for Fly deploys. On
non-Fly platforms, export `FENGINE_ENV=hosted` on the API process (alongside
the secrets above); `FENGINE_LOCAL_AUTH` must still stay unset.

`FENGINE_ALLOWED_USER_IDS` is identity configuration, not source code. Keep it
in protected host configuration and never commit real UUIDs. The API refuses
to start when invite-only mode has a missing, empty, duplicate, or malformed
list.

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

Both web variables are required together. A hosted build fails closed at the
sign-in screen when either is missing; it never falls back to demo auth. Add
`VITE_ENABLE_GOOGLE_AUTH=1` only when step 3 configured that provider.
Magic links return a one-time `?code=...`; the official client completes the
PKCE exchange on the same browser/device and then removes that parameter.

Host `apps/web/dist` on a static host (Fly static, Cloudflare Pages, Netlify,
nginx, Caddy, etc.). The production web build calls relative `/api/...` paths
(`apps/web/src/api.ts`); Vite's dev proxy is **not** used in production. The
static host must reverse-proxy `/api` to the API app's origin so the browser
stays same-origin — the API has no CORS middleware.

The web origin (e.g. `https://app.example.com`) and API origin (e.g.
`https://api.example.com`) may be different Fly apps or hosts; the **browser**
only ever talks to the web origin.

**Do not set `VITE_ALLOW_DEMO_AUTH`** — its absence plus a production
(non-`vite dev`) build is what disables the local demo identity fallback
(`apps/web/src/main.tsx`).

### Reverse proxy

Requirements for any proxy in front of `apps/web/dist`:

- Forward `/api/*` (and ideally bare `/api`) to the API origin with the `/api`
  path prefix preserved (`/api/projects` → `https://api.example.com/api/projects`).
- Pass through the client's `Authorization` header unchanged (JWT bearer tokens).
- Do **not** buffer streaming responses. Render progress uses `fetch` +
  `ReadableStream` on `/api/render-jobs/:id/events`; a buffering proxy delivers
  the whole body at once and breaks live progress. Disable response buffering on
  that path (or globally for `/api/`).

Process health (`/healthz`, `/readyz`) lives at the **API root**, not under
`/api`. For same-origin smoke (§7), expose it at `/api/healthz` via a rewrite
or dedicated rule (examples below).

**nginx** (serves `apps/web/dist` and proxies API):

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;
    root /var/www/f-motion/dist;

    location = /api/healthz {
        proxy_pass https://api.example.com/healthz;
        proxy_set_header Host api.example.com;
    }

    location /api/ {
        proxy_pass https://api.example.com/api/;
        proxy_http_version 1.1;
        proxy_set_header Host api.example.com;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }

    location = /api {
        return 301 /api/;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Cloudflare Pages** — Pages `_redirects` cannot proxy an external domain.
Use a Pages Function under `apps/web/functions/api/[[path]].js` instead. The
checked-in function forwards `/api/*` to `https://api.f-motion.com`, maps
`/api/healthz` to the API-root health endpoint, and returns the upstream
response without consuming its streaming body. Deploy with Wrangler from
`apps/web` so it includes both `dist` and `functions`.

Cloudflare may buffer SSE by default on proxied routes; if render progress
stalls until the job finishes, move `/api/render-jobs/*/events` to a Worker or
nginx/Caddy host where you can disable buffering (see nginx example above).

## 7. Smoke test

API directly (confirms the API app is up):

```sh
curl -f https://api.example.com/healthz
curl -f https://api.example.com/readyz   # 503 until Postgres is reachable
```

Same-origin proxy (confirms the web host forwards `/api` before auth testing):

```sh
curl -f https://app.example.com/api/healthz   # expect {"status":"ok"}, not index.html
```

Or in the browser DevTools console on `https://app.example.com`:

```js
fetch("/api/healthz").then((r) => r.json()).then(console.log);
```

### Invite-only operator rollout (manual)

Repository changes do not perform these live actions:

1. Disable new Supabase sign-ups and retain only intended test users.
2. Set `FENGINE_ACCESS_MODE=invite_only` and the UUID allowlist on the API.
3. Deploy the API.
4. Confirm an invited JWT can list drafts.
5. Confirm a valid but uninvited JWT receives generic HTTP 403 and does not
   create an application `User` row.
6. Enqueue three previews for one user; the next request should return HTTP 429
   `render_capacity`. Cancel/finish one and confirm another is admitted.
7. Sign in, confirm drafts still load after an access-token refresh, sign out,
   verify a protected request is rejected, then sign in again.

If rollout fails, restore the previous API image while keeping Supabase sign-up
disabled. Do not use `provision_verified` as a hosted rollback; it is a local
compatibility mode.

Then, from the hosted web origin: request a magic-link email, follow the
link, create a brief, choose a media source, attach media, render, and download —
end to end through the hosted API/worker/storage/Postgres. Upload a small
JPEG or MP4 from the editor — if the browser console shows a CORS error on
the storage host, fix bucket CORS (§2) before debugging the API.

## Required secrets (names only — never commit values)

| Var | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | API | session-mode Postgres |
| `QUEUE_DATABASE_URL` | worker | session-mode Postgres (pg-boss) |
| `R2_ENDPOINT`, `R2_REGION`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | API + worker | private object storage |
| `PEXELS_API_KEY` | API | stock media search |
| `SUPABASE_ISSUER`, `SUPABASE_AUDIENCE`, `SUPABASE_JWKS_URL` | API | JWT verification |
| `FENGINE_ACCESS_MODE`, `FENGINE_ALLOWED_USER_IDS` | API | hosted invite-only admission; exact Supabase user UUIDs |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | web build | Supabase client |
| `VITE_ENABLE_GOOGLE_AUTH` | web build | optional UI flag after Google provider setup |
| `FENGINE_LOCAL_AUTH` | — | must stay **unset** on every hosted process |
| `VITE_ALLOW_DEMO_AUTH` | — | must stay **unset** on every hosted web build |
