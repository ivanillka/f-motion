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

Outbox dispatch sends to pg-boss before recording `dispatchedAt`, using the
immutable UUID `WorkOutbox.id` as the pg-boss job ID. If that mark fails, the
next pass sends the same ID: its primary-key conflict returns no new job, and
the dispatcher records the existing job as dispatched. A send error leaves the
row undispatched. `dedupeKey` remains correlation metadata; the intentional
standard queue policy does not make `singletonKey` unique.

`WorkOutbox` is a delivery mechanism, not an analytics system of record. Its
undispatched polling predicate has a partial `createdAt` index. Undispatched
rows are never removed by cleanup. Dispatched rows older than
`OUTBOX_RETENTION_HOURS` (seven days by default) are deleted in bounded batches.
