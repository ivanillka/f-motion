# Local development

## Fast demo (no Postgres / Supabase / R2)

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:4173`. Without `VITE_SUPABASE_URL`, magic-link and Google
sign-in use the local test identity against an in-memory API. The worker renders
a real FFmpeg 720p preview. This is the Gate 2 UI path used by
`npm run test:e2e:web`.

## Full local stack (Postgres + MinIO + API + worker)

Requires Docker access (your user must be in the `docker` group).

```sh
cp .env.example .env
# Fill PEXELS_API_KEY and MEDIA_SIGNING_SECRET; keep FMOTION_LOCAL_AUTH=1 for local.

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

`FMOTION_LOCAL_AUTH=1` injects a fixed local owner and skips Supabase JWKS. Leave
it unset for real JWT verification.

Use PostgreSQL session-mode connections for pg-boss. Never expose the Pexels,
R2, media-signing, database, or queue credentials to either client. The web PWA
does not provide offline editing or rendering.

### Integration tests

```sh
export TEST_DATABASE_URL=postgresql://fmotion:fmotion@127.0.0.1:5432/fmotion
export TEST_S3_ENDPOINT=http://127.0.0.1:9000
export RUN_MEDIA_INTEGRATION=1
export RUN_QUEUE_INTEGRATION=1
export RUN_PROJECT_INTEGRATION=1
export RUN_RENDER_INTEGRATION=1
export RUN_WORKER_INTEGRATION=1
npm test
```
