# Self-host with one image

This path boots marketing, studio, API, FFmpeg worker, PostgreSQL, and MinIO
from a single container. It is not the hosted f-motion.com deploy.

Never set `FENGINE_LOCAL_AUTH=1`. Self-host uses `FENGINE_ENV=selfhost` and
`FENGINE_BOOTSTRAP_TOKEN`.

## Start

```sh
docker compose up
```

Or:

```sh
docker build -f deploy/Dockerfile -t f-motion .
docker run --rm -p 8080:8080 -v fmotion-data:/data f-motion
```

Open `http://127.0.0.1:8080` (marketing) and `http://127.0.0.1:8080/studio`.
The first boot prints an operator token. Enter it on the studio sign-in page.

Persist `/data` or drafts and the token file are lost.

## Environment names (values stay on the host)

| Name | Role |
|---|---|
| `FENGINE_ENV` / `FMOTION_ENV` | Must be `selfhost` |
| `FENGINE_BOOTSTRAP_TOKEN` | Optional override; generated into `/data/secrets/bootstrap` if unset |
| `FENGINE_PEXELS_BYOK_ENABLED` | `1` to let the operator connect a Pexels key later |
| `FENGINE_FAL_BYOK_ENABLED` | `1` to let the operator connect a FAL key later |
| `FENGINE_CREDENTIAL_KEY_V<n>` | Required only if a BYOK flag is `1` |
| `DATABASE_URL` | Defaults to the embedded Postgres |
| `R2_*` | Defaults to the embedded MinIO |

Do not set `PEXELS_API_KEY`, `FAL_KEY`, or `FAL_API_KEY`. Hosted and self-host
startup reject shared provider keys.

## Checks

- `GET /` — marketing home
- `GET /studio` — studio sign-in
- `GET /readyz` — API + database

If Docker is unavailable on a machine, the files in `deploy/` still land; run
the image where you have Docker access.
