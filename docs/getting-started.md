# Self-host onboarding

This guide creates an isolated F-Engine reference deployment using accounts
and data stores you control. The repository contains no maintainer credentials,
customer data, production domains, or shared hosted service.

If you only want to evaluate the workflow, use `npm run demo` from the root.
That path requires no accounts and does not contact Supabase, Pexels, cloud
storage, or a hosted database.

## One-box VPS (Docker Compose)

For an open-source **single-seat** install on a VPS — Postgres, MinIO, API,
worker, and web on one machine, **no Fly.io**, **no Fotium**, one operator
brings their own Supabase + Pexels/FAL keys (multi-user is paid / corporate) —
see [`docs/runbooks/vps-self-host.md`](runbooks/vps-self-host.md) and run:

```sh
cp deploy/vps/.env.example deploy/vps/.env
# edit deploy/vps/.env, then:
bash scripts/vps-up.sh
```

## 1. Prepare the local toolchain

- Node 24.15.0 and npm 11.12.1
- PostgreSQL 17
- S3-compatible object storage such as MinIO or Cloudflare R2
- FFmpeg and ffprobe
- Docker is optional but supported by `scripts/local-deps.sh`

```sh
npm ci
cp .env.example .env
```

`.env` is ignored by Git. Never commit it.

## 2. Create your services

For durable self-hosting, create:

1. A Supabase project for authentication.
2. A PostgreSQL session-mode connection for the API and worker queue.
3. A private S3-compatible bucket.
4. A Pexels account for each user who wants licensed stock search.

All accounts, billing, quotas, retention policies, and stored media remain
under your control.

## 3. Put values in the correct trust boundary

| Configuration | Location | Browser-safe? |
|---|---|---|
| `VITE_SUPABASE_URL` | web build | Yes |
| `VITE_SUPABASE_ANON_KEY` | web build | Yes, public browser key only |
| `DATABASE_URL`, `QUEUE_DATABASE_URL` | API/worker secret | No |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | API/worker secret | No |
| `FENGINE_PEXELS_BYOK_ENABLED` | API configuration | No credential value |
| `FENGINE_CREDENTIAL_KEY_V<n>` | API secret | No |
| Supabase service-role key | Not used | Never expose |

Only variables prefixed with `VITE_` can enter the browser build. A Supabase
service-role key must never be placed in any `VITE_*` variable.

With Pexels BYOK enabled, each authenticated user enters their own API key in
Settings. The browser sends it over HTTPS once; the API validates and encrypts
it with the versioned credential key, returns only last-four metadata, and uses
it only for that owner's Pexels requests. A shared `PEXELS_API_KEY` is forbidden.

## 4. Configure authentication

Set the Supabase issuer, audience, and JWKS URL for the API. Set the project
URL and public browser key for the web build. Add the exact web origin with a
trailing slash to the Supabase redirect allowlist.

For a private deployment:

```dotenv
FENGINE_ACCESS_MODE=invite_only
FENGINE_ALLOWED_USER_IDS=<comma-separated-supabase-user-uuids>
```

Disable open Supabase signup as defense in depth. The API allowlist remains
the authoritative admission check.

## 5. Configure rendering

The reference worker defaults to 1080×1920 with no watermark. Hosts may set:

```dotenv
RENDER_WIDTH=1080
RENDER_HEIGHT=1920
RENDER_WATERMARK=My preview
```

The engine validates dimensions and presentation before constructing FFmpeg
arguments. Branding belongs to the host, not the engine package.

## 6. Start a durable local stack

With Docker available:

```sh
bash scripts/local-deps.sh
npx prisma migrate deploy
npm run build
```

Then start the API, worker, and web client in separate terminals:

```sh
set -a && source .env && set +a
npm run start --workspace @f-engine/reference-api
```

```sh
set -a && source .env && set +a
npm run start --workspace @f-engine/reference-worker
```

```sh
set -a && source .env && set +a
npm run dev --workspace @f-engine/reference-web -- --host 127.0.0.1 --port 4173
```

## 7. Verify before exposing the service

```sh
npm run lint
npm test
npm run build
npm run test:package-consumer
npm run test:e2e:web
```

Also verify:

- an invited user can sign in and list drafts;
- an uninvited valid user receives a generic denial;
- uploaded media remains private and uses expiring URLs;
- sign-out invalidates the browser session;
- no real secret appears in the web bundle or repository.

AI generation, payments, and third-party paid-provider integrations are not
included. Add them only in a host after separately reviewing credentials,
licensing, cost controls, retention, and abuse limits.
