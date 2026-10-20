-- Lock the public schema away from the Supabase Data API (PostgREST).
-- F-Motion reads and writes Postgres only over direct connections (pg, pg-boss,
-- prisma migrate) as the table owner, so nothing here changes app behavior:
-- row level security without FORCE does not apply to the owner.
-- On plain Postgres (CI, VPS self-host) the anon and authenticated roles do not
-- exist, so the REVOKE and DEFAULT PRIVILEGES blocks are a no-op there.

-- 1. Row level security on every public table this role owns, no policies.
--    Includes _prisma_migrations. pg-boss lives in its own "pgboss" schema.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    IF t.owner = current_user THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    ELSE
      RAISE NOTICE 'skip RLS on public.% (owner %, not %)', t.relname, t.owner, current_user;
    END IF;
  END LOOP;
END
$$;

-- 2. Drop Data API grants on existing objects, and stop future auto grants
--    from objects this role creates.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END
$$;
