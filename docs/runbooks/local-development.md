# Local development

## Fast demo (no Postgres / Supabase / R2)

```sh
npm ci
npm run demo
```

Open `http://127.0.0.1:4173`. Without `VITE_SUPABASE_URL`, magic-link and Google
sign-in use the local test identity against an in-memory API. The worker renders
a real FFmpeg 720p preview. This is the Gate 2 vertical-slice path used by
`npm run test:e2e:web`.

## Full local stack

1. Copy `.env.example` to an ignored `.env` and replace every placeholder.
2. Start disposable PostgreSQL and S3-compatible storage.
3. Run `npm ci`, then `npm run build`.
4. Start `@f-motion/api`, the worker, and `@f-motion/web` separately.

Use PostgreSQL session-mode connections for pg-boss. Never expose the Pexels,
R2, media-signing, database, or queue credentials to either client. The web PWA
does not provide offline editing or rendering.

For local trust-boundary verification, set `RUN_MEDIA_INTEGRATION=1`,
`RUN_QUEUE_INTEGRATION=1`, `TEST_DATABASE_URL`, and `TEST_S3_ENDPOINT` before
`npm test`.
