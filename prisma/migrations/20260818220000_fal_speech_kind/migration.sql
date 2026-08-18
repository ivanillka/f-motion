-- Postgres rejects using a newly added enum value in the same transaction.
-- Commit this ADD VALUE first; the CHECK that names speech is 20260818220100.
ALTER TYPE "GenerationKind" ADD VALUE 'speech';
