import pg from "pg";
import { PostgresProjectRepository } from "./domain.js";
import { createApp } from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

const pool = new pg.Pool({ connectionString: required("DATABASE_URL") });
createApp({
  projects: new PostgresProjectRepository(pool),
  authConfig: {
    issuer: required("AUTH_ISSUER"),
    audience: required("AUTH_AUDIENCE"),
    jwksUrl: new URL(required("AUTH_JWKS_URL"))
  },
  accountState: async (ownerId) => {
    const result = await pool.query<{ state: string }>(
      `SELECT state FROM "User" WHERE id = $1`,
      [ownerId]
    );
    return result.rows[0]?.state;
  }
}).listen(Number(process.env.PORT ?? 3000));
