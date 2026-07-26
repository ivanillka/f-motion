# Local development

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
