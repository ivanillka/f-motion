-- Operator-only usage report for the open beta. Read it from the Supabase SQL
-- editor or psql as the database owner; the app never queries it.
-- Source is "UsageLedger": a 'free_grant' row marks a user's first sign-in and
-- every preview or final render debits one idempotent row. Rows disappear with
-- the user (ON DELETE CASCADE), so Hard Delete also removes them from the report.
-- The views live in their own schema, which the Supabase Data API does not
-- expose, and anon/authenticated get no access to it.

CREATE SCHEMA IF NOT EXISTS fmotion_report;

-- One row per user per ISO week (Monday start, UTC) with at least one render.
CREATE OR REPLACE VIEW fmotion_report.weekly_user_usage AS
WITH first_seen AS (
  SELECT "ownerId", date_trunc('week', min("createdAt"))::date AS first_week
  FROM "UsageLedger"
  GROUP BY "ownerId"
)
SELECT
  l."ownerId" AS owner_id,
  date_trunc('week', l."createdAt")::date AS week_start,
  count(*) FILTER (WHERE l.reason = 'render_final')::int AS finals,
  count(*) FILTER (WHERE l.reason = 'render_preview')::int AS previews,
  f.first_week,
  (f.first_week < date_trunc('week', l."createdAt")::date) AS returning
FROM "UsageLedger" l
JOIN first_seen f USING ("ownerId")
WHERE l.reason IN ('render_final', 'render_preview')
GROUP BY l."ownerId", date_trunc('week', l."createdAt")::date, f.first_week;

-- One row per week, no user ids. "reels" are final renders.
--   active_users     users with at least one render that week
--   new_users        users whose first sign-in was that week
--   returning_users  active users who signed up in an earlier week
--   retained_users   active users who were also active the week before
--   return_rate      returning_users / active_users
CREATE OR REPLACE VIEW fmotion_report.weekly_summary AS
WITH signups AS (
  SELECT date_trunc('week', min("createdAt"))::date AS week_start, "ownerId"
  FROM "UsageLedger"
  GROUP BY "ownerId"
),
weeks AS (
  SELECT week_start FROM fmotion_report.weekly_user_usage
  UNION
  SELECT week_start FROM signups
)
SELECT
  w.week_start,
  count(DISTINCT u.owner_id)::int AS active_users,
  (SELECT count(*)::int FROM signups s WHERE s.week_start = w.week_start) AS new_users,
  count(DISTINCT u.owner_id) FILTER (WHERE u.returning)::int AS returning_users,
  count(DISTINCT u.owner_id) FILTER (WHERE EXISTS (
    SELECT 1 FROM fmotion_report.weekly_user_usage p
    WHERE p.owner_id = u.owner_id AND p.week_start = w.week_start - 7
  ))::int AS retained_users,
  coalesce(sum(u.finals), 0)::int AS reels,
  coalesce(sum(u.previews), 0)::int AS previews,
  round(coalesce(sum(u.finals), 0)::numeric / nullif(count(DISTINCT u.owner_id), 0), 2) AS reels_per_active_user,
  round(
    (count(DISTINCT u.owner_id) FILTER (WHERE u.returning))::numeric
      / nullif(count(DISTINCT u.owner_id), 0),
    2
  ) AS return_rate
FROM weeks w
LEFT JOIN fmotion_report.weekly_user_usage u ON u.week_start = w.week_start
GROUP BY w.week_start;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA fmotion_report FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA fmotion_report FROM %I', r);
    END IF;
  END LOOP;
END
$$;
