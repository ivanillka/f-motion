-- Postgres rejects using a newly added enum value in the same transaction.
ALTER TYPE "GenerationKind" ADD VALUE 'analyze';
