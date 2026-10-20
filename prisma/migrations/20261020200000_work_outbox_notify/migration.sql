-- Wake the worker when work lands in the outbox, instead of it polling.
-- One NOTIFY per INSERT statement, delivered on commit (so a rolled back
-- enqueue never wakes anyone). Postgres folds identical notifications in one
-- transaction. The payload is empty: the worker still reads "WorkOutbox".
-- Additive and safe with the old worker (nobody listening is a no-op).
CREATE FUNCTION work_outbox_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('fmotion_work_outbox', '');
  RETURN NULL;
END
$$;

CREATE TRIGGER "WorkOutbox_notify"
AFTER INSERT ON "WorkOutbox"
FOR EACH STATEMENT EXECUTE FUNCTION work_outbox_notify();

-- Same Data API rule as 20261020190000_data_api_lockdown: no anon access.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION work_outbox_notify() FROM %I', r);
    END IF;
  END LOOP;
END
$$;
