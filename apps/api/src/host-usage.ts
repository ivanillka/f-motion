import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type UsageReason = "free_grant" | "render_preview" | "render_final" | "top_up";

export class QuotaExceededError extends Error {
  constructor() {
    super("host usage quota exceeded");
  }
}

export function freeRenderUnitsFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.FENGINE_FREE_RENDER_UNITS?.trim();
  if (!raw) return 25;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("FENGINE_FREE_RENDER_UNITS must be an integer from 0 to 10000");
  }
  return value;
}

export function renderUnitCost(kind: "preview" | "final"): { cost: number; reason: UsageReason } {
  return kind === "final"
    ? { cost: 2, reason: "render_final" }
    : { cost: 1, reason: "render_preview" };
}

export interface UsageView {
  unit: "render_unit";
  balance: number;
  free_grant: number;
  costs: { preview: number; final: number };
}

export class PostgresHostUsageService {
  constructor(
    readonly pool: Pool,
    readonly freeGrant: number = 25
  ) {}

  async ensureFreeGrant(ownerId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO "UsageBalance" ("ownerId", balance, "updatedAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT ("ownerId") DO NOTHING
         RETURNING "ownerId"`,
        [ownerId, this.freeGrant]
      );
      if (inserted.rowCount && this.freeGrant > 0) {
        await client.query(
          `INSERT INTO "UsageLedger" (id, "ownerId", delta, reason, "idempotencyKey")
           VALUES ($1, $2, $3, 'free_grant', 'free_grant')
           ON CONFLICT DO NOTHING`,
          [randomUUID(), ownerId, this.freeGrant]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async status(ownerId: string): Promise<UsageView> {
    await this.ensureFreeGrant(ownerId);
    const result = await this.pool.query<{ balance: number }>(
      `SELECT balance FROM "UsageBalance" WHERE "ownerId" = $1`,
      [ownerId]
    );
    return {
      unit: "render_unit",
      balance: result.rows[0]?.balance ?? 0,
      free_grant: this.freeGrant,
      costs: { preview: 1, final: 2 }
    };
  }

  /** Debits host units for a render. Idempotent per job id. */
  async consumeRender(
    ownerId: string,
    kind: "preview" | "final",
    jobId: string
  ): Promise<number> {
    await this.ensureFreeGrant(ownerId);
    const { cost, reason } = renderUnitCost(kind);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const prior = await client.query(
        `SELECT id FROM "UsageLedger"
          WHERE "ownerId" = $1 AND "idempotencyKey" = $2`,
        [ownerId, jobId]
      );
      if (prior.rowCount) {
        const balance = await client.query<{ balance: number }>(
          `SELECT balance FROM "UsageBalance" WHERE "ownerId" = $1`,
          [ownerId]
        );
        await client.query("COMMIT");
        return balance.rows[0]?.balance ?? 0;
      }
      const updated = await client.query<{ balance: number }>(
        `UPDATE "UsageBalance"
            SET balance = balance - $2, "updatedAt" = NOW()
          WHERE "ownerId" = $1 AND balance >= $2
          RETURNING balance`,
        [ownerId, cost]
      );
      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        throw new QuotaExceededError();
      }
      await client.query(
        `INSERT INTO "UsageLedger" (id, "ownerId", delta, reason, "idempotencyKey")
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), ownerId, -cost, reason, jobId]
      );
      await client.query("COMMIT");
      return updated.rows[0]!.balance;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* ignore */ }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Test helper: credit paid units (top-up stub until payments land). */
  async topUp(ownerId: string, units: number, idempotencyKey: string): Promise<number> {
    if (!Number.isInteger(units) || units <= 0 || units > 100_000) {
      throw new Error("invalid top-up");
    }
    await this.ensureFreeGrant(ownerId);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO "UsageLedger" (id, "ownerId", delta, reason, "idempotencyKey")
         VALUES ($1, $2, $3, 'top_up', $4)
         ON CONFLICT DO NOTHING`,
        [randomUUID(), ownerId, units, idempotencyKey]
      );
      const result = await client.query<{ balance: number }>(
        `UPDATE "UsageBalance"
            SET balance = balance + $2, "updatedAt" = NOW()
          WHERE "ownerId" = $1
          RETURNING balance`,
        [ownerId, units]
      );
      await client.query("COMMIT");
      return result.rows[0]?.balance ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function ensureFreeGrantOnClient(
  client: PoolClient,
  ownerId: string,
  freeGrant: number
): Promise<void> {
  const inserted = await client.query(
    `INSERT INTO "UsageBalance" ("ownerId", balance, "updatedAt")
     VALUES ($1, $2, NOW())
     ON CONFLICT ("ownerId") DO NOTHING
     RETURNING "ownerId"`,
    [ownerId, freeGrant]
  );
  if (inserted.rowCount && freeGrant > 0) {
    await client.query(
      `INSERT INTO "UsageLedger" (id, "ownerId", delta, reason, "idempotencyKey")
       VALUES ($1, $2, $3, 'free_grant', 'free_grant')
       ON CONFLICT DO NOTHING`,
      [randomUUID(), ownerId, freeGrant]
    );
  }
}
