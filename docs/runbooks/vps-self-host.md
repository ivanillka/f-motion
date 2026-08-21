# VPS self-host (open source, single user)

Run Frame Engine on one VPS with Docker Compose. This path is for **one operator**.

| Edition | Seats | How |
|---------|-------|-----|
| **Open source (this doc)** | 1 user | `FENGINE_ENV=selfhost` + `FENGINE_ACCESS_MODE=single_user` + one UUID |
| **Corporate / paid** | Several users | Not this compose stack — contact sales / paid deployment |

Not included here: Fly.io, Fotium partner branding, shared Pexels/FAL server keys. Media providers use **BYOK** in the app.

## What you get

| Service | Role |
|---------|------|
| `web` | Static SPA on `:8080` |
| `api` | Fastify API |
| `worker` | BullMQ jobs (export, AI, media) |
| `postgres` | App DB |
| `minio` | S3-compatible media (`:9000` API, `:9001` console) |

Auth still uses **your** Supabase project (email/password or magic link). The API admits **exactly one** user UUID.

## Prerequisites

- Docker Engine + Compose v2
- A free [Supabase](https://supabase.com) project (Auth only is enough)
- Ports free: `8080` (app), optionally `9000`/`9001` (MinIO)

## Install

```bash
git clone <this-repo> && cd <this-repo>
./install.sh
```

First run creates `deploy/vps/.env` and generates `FENGINE_CREDENTIAL_KEY_V1`.
Edit that file:

1. Supabase URL + anon key (+ JWKS / issuer for the API)
2. `FENGINE_ALLOWED_USER_IDS` = **one** UUID — create that user in Supabase Auth first, then paste their `id`
3. Optional on a real VPS: change `POSTGRES_PASSWORD` / `MINIO_ROOT_PASSWORD`, set public `FENGINE_WEB_ORIGIN` and `R2_PUBLIC_ENDPOINT`
4. Leave `FENGINE_ENV=selfhost` and `FENGINE_ACCESS_MODE=single_user`

```bash
./install.sh
# equivalent: bash scripts/vps-up.sh   or   npm run vps:up
```

Open `http://YOUR_HOST:8080/app/` and sign in as that single user.

## Credentials (BYOK)

In the app: **Settings → Credentials**. Store your own Pexels and/or FAL keys. They are encrypted with `FENGINE_CREDENTIAL_KEY_V1`. Do not put provider keys in `deploy/vps/.env`.

## Single-seat enforcement

The API refuses to start when:

- `FENGINE_ENV=selfhost` but mode is not `single_user`, or
- `single_user` has zero or more than one UUID in `FENGINE_ALLOWED_USER_IDS`

Extra signed-in accounts are rejected at the API (`owner_not_admitted`). For several seats, use a paid / corporate deployment — do not widen this compose file.

## Ops

```bash
cd deploy/vps
docker compose --env-file .env logs -f api worker
docker compose --env-file .env down
```

MinIO console: `http://YOUR_HOST:9001` (keys from `.env`).

Upgrade: `git pull` then `bash scripts/vps-up.sh` again (images rebuild).

## TLS / domain

Put nginx/Caddy in front of `:8080` and terminate TLS. Set `CORS_ORIGIN` and `R2_PUBLIC_ENDPOINT` to the public origins users will use.

## Not this path

- Multi-user invite lists or open mode → corporate product
- Fly.toml / GitHub Actions deploy → cloud SaaS
- Fotium partner email gates → stripped from the web image build
