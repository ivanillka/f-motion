# One-box VPS self-host (open source)

This path runs F-Motion on a single machine with Docker Compose:

- Postgres 17
- MinIO (private object storage)
- API + worker (same image; worker runs FFmpeg)
- nginx web (marketing `/` + studio `/app/`)

It is **not** the Fly.io / Cloudflare Pages hosted demo. It does **not** include
Fotium partner branding, trusted import tokens, or shared provider keys.
Each signed-in user connects their own Pexels and FAL credentials in Settings.

## What you still need outside the box

1. A **Supabase** project you control (Auth only — magic link or Google).
2. Optional: your own domain + TLS terminator in front of ports `8080` and
   `9000` (or change the published ports in `.env`).

Everything else — database, media, render queue, web UI — stays on the VPS.

## Install

```sh
cp deploy/vps/.env.example deploy/vps/.env
# Edit deploy/vps/.env:
#   - Supabase issuer / JWKS / Vite public keys
#   - FENGINE_ALLOWED_USER_IDS (your Supabase Auth user UUID)
#   - FENGINE_CREDENTIAL_KEY_V1=$(openssl rand -base64 32)
#   - FENGINE_WEB_ORIGIN and R2_PUBLIC_ENDPOINT to the browser-reachable host
bash scripts/vps-up.sh
```

Open `http://YOUR_HOST:8080/app/` (or your `FENGINE_WEB_ORIGIN`).

In Supabase → Authentication → URL configuration, allow:

```text
https://YOUR_HOST/app/
```

(or `http://…` for a private LAN install).

## Environment map

| Concern | Where |
|---|---|
| Supabase public keys | `VITE_*` (baked into the web image at build time) |
| Supabase JWKS | API `SUPABASE_*` |
| Invite allowlist | `FENGINE_ACCESS_MODE=invite_only` + `FENGINE_ALLOWED_USER_IDS` |
| Object storage (server) | `R2_ENDPOINT=http://minio:9000` (compose sets this) |
| Object storage (browser) | `R2_PUBLIC_ENDPOINT` (must be reachable from the browser) |
| Provider spend | User BYOK in Settings (`FENGINE_*_BYOK_ENABLED=1`) |

Leave unset forever on this path:

- `VITE_PARTNER_BRAND_EMAIL` (Fotium chrome)
- `FENGINE_IMPORT_*` / `SUPABASE_*_EXTRA` (Fotium handoff)
- `FENGINE_LOCAL_AUTH` / `VITE_ALLOW_DEMO_AUTH`
- `FENGINE_ENV=hosted` (Fly private demo mode)
- `PEXELS_API_KEY` / `FAL_KEY` (shared keys — rejected at startup)

## Verify

```sh
curl -fsS http://127.0.0.1:8080/app/ | head
docker compose -f deploy/vps/docker-compose.yml --env-file deploy/vps/.env ps
```

Sign in as an allowlisted user, attach a still, connect FAL/Pexels if you want
AI or stock, and render a preview.

## Upgrades

Rebuild after pulling:

```sh
bash scripts/vps-up.sh
```

Migrations run automatically via the `migrate` service before API/worker start.

## Security notes

- Change `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD` before exposing a VPS.
- Keep MinIO private except for the short-lived signed URLs the API issues.
- Put TLS in front for any internet-facing install; then set
  `FENGINE_WEB_ORIGIN` and `R2_PUBLIC_ENDPOINT` to `https://…`.
- Disable open Supabase signup; the API allowlist is still authoritative.
