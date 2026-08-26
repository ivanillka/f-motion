# Self-host with one image

This is the **VPS product**: one owner, one image, no Supabase, no payment.
It is not f-motion.com and not the corporate teams product.

Never set `FENGINE_LOCAL_AUTH=1`. Self-host uses `FENGINE_ENV=selfhost` and a
single owner account created in the studio on first open.

## Start

```sh
docker compose up
```

Or:

```sh
docker build -f deploy/Dockerfile -t f-motion .
docker run --rm -p 8080:8080 -v fmotion-data:/data f-motion
```

Open `http://127.0.0.1:8080/` and create the owner (name, email, password).
Then connect optional Pexels or FAL keys, or skip to drafts.

Persist `/data` or drafts and the owner account are lost.

If you forget the owner password, set `FENGINE_SELFHOST_RESET_OWNER=1` on the
container, restart, and create the owner again (same or new email). Existing
drafts stay on that owner. Then unset the variable and restart so the setup
form cannot be reused.

## Environment names (values stay on the host)

| Name | Role |
|---|---|
| `FENGINE_ENV` / `FMOTION_ENV` | Must be `selfhost` |
| `FENGINE_PEXELS_BYOK_ENABLED` | Defaults to `1` so the owner can connect a Pexels key |
| `FENGINE_PIXABAY_BYOK_ENABLED` | Defaults to `1` so the owner can connect a Pixabay key |
| `FENGINE_FAL_BYOK_ENABLED` | Defaults to `1` so the owner can connect a FAL key |
| `FENGINE_CREDENTIAL_KEY_V<n>` | Generated into `/data/secrets/credential-key` if unset |
| `FENGINE_SELFHOST_RESET_OWNER` | Set to `1` only to reopen first-open owner setup, then unset |
| `DATABASE_URL` | Defaults to the embedded Postgres |
| `R2_*` | Defaults to the embedded MinIO |

Do not set `PEXELS_API_KEY`, `PIXABAY_API_KEY`, `FAL_KEY`, or `FAL_API_KEY`. Hosted and self-host
startup reject shared provider keys.

## Checks

- `GET /` — studio
- `GET /readyz` — API + database (`{"status":"ready"}`)

`/studio` may 301 to `/`.

`docker compose up` was booted to those two checks. Persist `/data` across
restarts so the owner account survives.
