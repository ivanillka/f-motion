# PostgreSQL queue decision

Use `pg-boss` in the worker. It supports PostgreSQL transaction-based enqueue,
singleton/idempotent job keys, SKIP LOCKED leasing, heartbeat recovery,
configurable retry/backoff, cancellation, and job progress without a hand-built
scheduler. It works over a normal PostgreSQL connection; Supabase session-mode
connections are preferred, while transaction-mode pooling must be tested before
production because listeners and long leases need stable connections.

`pg-boss` exposes queue and job state for metrics. Current maintenance is checked
through npm/GitHub release activity when upgrading. A killed worker's expired
lease is recovered by a replacement; immutable render object keys make completion
idempotent. API transactions use an outbox row so enqueue cannot race commit.
