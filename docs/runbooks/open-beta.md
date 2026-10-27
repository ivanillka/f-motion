# Open beta switch (hosted f-motion.com)

The hosted studio is invite-only by default. One API flag opens it to
self-service sign-up with a seat cap. Nothing changes until the operator flips
it. Cloudflare Pages, the Hetzner API/worker, and the VPS web container all
build from the same source, so ship them together in one release. No Fly.

## What the flag does

| Setting | Default | Effect |
|---|---|---|
| `FENGINE_ACCESS_MODE=open_beta` | `invite_only` | Any Supabase user with a verified email can use the studio until the seat cap is reached. |
| `FENGINE_OPEN_BETA_MAX_USERS` | `50` | Total application accounts (`User` rows, including existing ones). A new user past the cap gets the same generic 403 as an uninvited user, and no row is created. |
| `FENGINE_ALLOWED_USER_IDS` | optional in `open_beta` | UUIDs listed here are always admitted, even when the beta is full. Keep the operator account here. |
| `FENGINE_FREE_RENDER_UNITS` | `25` | One-time render allowance per new account (preview 1 unit, final 2 units, so about 12 final reels). Past it, renders answer HTTP 402 `quota_exceeded`. |

Spend stays bounded:

- Render compute on the VPS: at most `MAX_USERS x FREE_RENDER_UNITS` units
  (50 x 25 = 1250 by default), plus the existing per-user limit of 3 queued
  renders.
- FAL and Kokoro: hosted F-Motion has no shared FAL key (`FAL_KEY` is refused at
  startup). Generation and voice run only on a user's own connected FAL key, so
  open beta users never spend the operator's FAL or Kokoro credit. Partner
  import still uses `FENGINE_IMPORT_OWNER_ID` and is unchanged.

Concurrent first sign-ins can overshoot the cap by a few seats (single SQL
statement, no lock). Lower the cap a little if it must be exact.

## Turn it on

1. Merge the release and run the usual hosted release on the VPS
   (`/opt/f-motion-hosted`): rollback tags, then the `migrate` service (adds the
   `fmotion_report` views), then `up -d --no-deps api worker web`. Deploy the
   Cloudflare Pages build from the same commit.
2. Supabase dashboard, project f-motion-prod: **Authentication, Providers,
   Email**, turn **Allow new users to sign up** on. Leave email confirmation on.
3. In `deploy/hetzner/.env` on the VPS set:

   ```sh
   FENGINE_ACCESS_MODE=open_beta
   FENGINE_OPEN_BETA_MAX_USERS=50
   # keep your own UUID in FENGINE_ALLOWED_USER_IDS
   ```

4. Restart only the API: `docker compose --env-file .env up -d --no-deps api`.
5. Smoke: sign in with a fresh email from a private window, create a draft, and
   render one preview. `/api/me/usage` should show `balance` 24.

## Turn it off (rollback)

1. Set `FENGINE_ACCESS_MODE=invite_only` (with a non-empty
   `FENGINE_ALLOWED_USER_IDS`) and restart the API. Beta accounts that are not
   on the allowlist get a generic 403 from then on; their data stays until Hard
   Delete.
2. Turn Supabase sign-ups off again.

No code rollback is needed. The report views are read-only and harmless.

## Weekly usage report

Operator only. Run in the Supabase SQL editor (or psql as the database owner):

```sql
SELECT * FROM fmotion_report.weekly_summary ORDER BY week_start DESC LIMIT 8;
```

| Column | Meaning |
|---|---|
| `week_start` | ISO week, Monday, UTC |
| `active_users` | users with at least one render that week |
| `new_users` | first sign-in that week |
| `returning_users` | active users who signed up in an earlier week |
| `retained_users` | active users who were also active the week before |
| `reels`, `previews` | final and preview renders |
| `reels_per_active_user` | `reels / active_users` |
| `return_rate` | `returning_users / active_users` |

Per user detail (Supabase user UUID, no email) is in
`fmotion_report.weekly_user_usage`. Keep it inside the operator console; never
paste it into shared docs.

The report reads `UsageLedger` only: the free grant row marks a user's first
sign-in and every render debit is one row. No third-party analytics, no
cookies, no data shared across users. Hard Delete cascades the ledger, so
deleted users leave the report too. The `fmotion_report` schema is not exposed
to the Supabase Data API, and the migration revokes `anon` and `authenticated`.
