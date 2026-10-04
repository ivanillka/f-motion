/**
 * Sessions for one API process.
 * The hosted database is a session pooler of about 15 clients. node-pg defaults
 * each pool to 10, and the worker opens two more (its own pool and pg-boss).
 * 4 + 3 + 4 stays under that limit, with one spare for pg-boss LISTEN.
 * ponytail: fixed split, not a setting. Raise these together if the pooler limit grows.
 */
export const apiDatabasePoolMax = 4;
