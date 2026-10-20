/**
 * Sessions for one API process.
 * The hosted database is a session pooler of about 15 clients. node-pg defaults
 * each pool to 10, and the worker opens two more (its own pool and pg-boss).
 * 4 + 3 + 4 stays under that limit, and the worker's one outbox LISTEN session
 * (apps/worker/src/outbox-wake.ts) makes 12 of about 15.
 * ponytail: fixed split, not a setting. Raise these together if the pooler limit grows.
 */
export const apiDatabasePoolMax = 4;

/**
 * node-pg closes an idle client after 10s, and the Supabase session pooler
 * re-runs its setup (`DISCARD ALL`, `pgbouncer.get_auth`) on every reconnect.
 * Reconnects cost egress and buy nothing between requests, so keep warm clients
 * for five minutes. The 4 + 3 + 4 pool split is unchanged.
 */
export const apiDatabaseIdleTimeoutMillis = 300_000;
