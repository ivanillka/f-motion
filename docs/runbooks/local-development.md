# Local development

## Fast demo (no Postgres / Supabase / R2)

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:4173`. Without both Supabase web variables, the email
button uses an explicit session-only demo identity against an in-memory API.
No bearer token is stored by the demo gateway. The worker renders a real FFmpeg
720p preview. This is the Gate 2 UI path used by
`npm run test:e2e:web`.

## Full local stack (Postgres + MinIO + API + worker)

Requires Docker access (your user must be in the `docker` group).

```sh
cp .env.example .env
# To test stock search, enable FENGINE_PEXELS_BYOK_ENABLED and/or
# FENGINE_PIXABAY_BYOK_ENABLED, configure the credential vault key, then
# connect your own key in Settings.

bash scripts/local-deps.sh
npx prisma migrate deploy
npm ci
npm run build

# Terminal A — API on :3000
set -a && source .env && set +a
npm run start --workspace apps/api

# Terminal B — worker
set -a && source .env && set +a
npm run start --workspace apps/worker

# Terminal C — web (proxies /api to :3000 via VITE_API_PROXY)
set -a && source .env && set +a
npm run dev --workspace apps/web -- --host 127.0.0.1 --port 4173
```

Or after deps + migrate + build: `npm run stack` starts API and prints worker/web
commands.

`FENGINE_LOCAL_AUTH=1` injects a fixed local owner and skips Supabase JWKS. Leave
it unset for real JWT verification.

**Never set `FENGINE_LOCAL_AUTH=1` or `VITE_ALLOW_DEMO_AUTH=1` on a public host.**
The API refuses to boot with local auth when `NODE_ENV=production` or
`FENGINE_ENV=hosted`; the web client only falls back to the demo token in
`vite dev` or with `VITE_ALLOW_DEMO_AUTH=1` set, which hosted builds must not set.
Real browser auth uses Supabase's PKCE client, including persisted session
refresh and callback detection.

Use PostgreSQL session-mode connections for pg-boss. A user's Pexels key is the
only Pexels credential accepted by authenticated Settings; never put it in a
VITE variable. Never expose R2, database, or queue credentials to either client. The web PWA does not
provide offline editing or rendering.

If you test browser uploads against MinIO from an origin other than the API
(e.g. Vite on `:4173` PUTs to `:9000`), configure MinIO bucket CORS for that
origin with `PUT`, `GET`, `HEAD`, and `Content-Type` — same rules as hosted
deploy (see `docs/runbooks/hosted-deploy.md` §2).

### Integration tests

```sh
export TEST_DATABASE_URL=postgresql://fengine:fengine@127.0.0.1:5432/fengine
export TEST_S3_ENDPOINT=http://127.0.0.1:9000
export RUN_MEDIA_INTEGRATION=1
export RUN_FAL_INTEGRATION=1
export RUN_QUEUE_INTEGRATION=1
export RUN_PROJECT_INTEGRATION=1
export RUN_RENDER_INTEGRATION=1
export RUN_WORKER_INTEGRATION=1
npm test
```
