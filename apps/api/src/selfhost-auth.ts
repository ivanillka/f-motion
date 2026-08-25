import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { UnauthorizedError } from "./auth.js";
import { engineEnv } from "./product.js";

export { engineEnv } from "./product.js";

const scryptAsync = promisify(scrypt);
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const passwordMin = 8;
const passwordMax = 200;

export function assertSelfhostConfig(env: Record<string, string | undefined>): void {
  if (engineEnv(env) !== "selfhost") throw new Error("FENGINE_ENV=selfhost is required");
  if (env.FENGINE_LOCAL_AUTH === "1") {
    throw new Error("FENGINE_LOCAL_AUTH is forbidden when FENGINE_ENV=selfhost");
  }
}

/** Physical/SSH access only. Unset after the owner password is replaced. */
export function selfhostOwnerResetRequested(env: Record<string, string | undefined> = process.env): boolean {
  return (env.FENGINE_SELFHOST_RESET_OWNER ?? env.FMOTION_SELFHOST_RESET_OWNER) === "1";
}

export function ownerEmailMatches(stored: string | undefined, email: string): boolean {
  return stored?.trim().toLowerCase() === email;
}

export class SetupClosedError extends Error {
  constructor() {
    super("This install already has an owner.");
  }
}

export class SelfhostValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface OwnerSessionView {
  access_token: string;
  owner_id: string;
  display_name: string;
}

export interface SelfhostOwnerAuth {
  setupNeeded(): Promise<boolean>;
  setup(input: unknown): Promise<OwnerSessionView>;
  login(input: unknown): Promise<OwnerSessionView>;
  ownerIdForAuthorization(authorization: string | undefined): Promise<string>;
  logout(authorization: string | undefined): Promise<void>;
}

interface OwnerRow {
  id: string;
  email?: string;
  passwordHash?: string;
  displayName?: string;
  state: string;
}

interface SessionRow {
  id: string;
  ownerId: string;
  tokenHash: string;
  expiresAt: number;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new SelfhostValidationError("email is required");
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SelfhostValidationError("email is invalid");
  }
  return email;
}

function normalizePassword(value: unknown): string {
  if (typeof value !== "string") throw new SelfhostValidationError("password is required");
  if (value.length < passwordMin || value.length > passwordMax) {
    throw new SelfhostValidationError(`password must be ${passwordMin}–${passwordMax} characters`);
  }
  return value;
}

function normalizeName(value: unknown, email: string): string {
  if (value === undefined || value === null || value === "") {
    return email.slice(0, email.indexOf("@") || 64).slice(0, 64) || "Owner";
  }
  if (typeof value !== "string") throw new SelfhostValidationError("display_name is invalid");
  const name = value.trim();
  if (!name || name.length > 64) throw new SelfhostValidationError("display_name is invalid");
  return name;
}

function parseAccount(input: unknown): { email: string; password: string; displayName: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new SelfhostValidationError("invalid account");
  }
  const body = input as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  return {
    email,
    password: normalizePassword(body.password),
    displayName: normalizeName(body.display_name, email)
  };
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32) as Buffer;
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const hash = await scryptAsync(password, salt, expected.length) as Buffer;
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function mintSessionToken(): string {
  return `fms_${randomBytes(32).toString("hex")}`;
}

function bearerToken(authorization: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
  if (!match?.[1]) throw new UnauthorizedError();
  return match[1];
}

abstract class OwnerAuthBase implements SelfhostOwnerAuth {
  protected abstract loadOwners(): Promise<OwnerRow[]>;
  protected abstract insertOwner(owner: OwnerRow): Promise<void>;
  protected abstract claimOwner(id: string, email: string, passwordHash: string, displayName: string): Promise<void>;
  protected abstract insertSession(session: SessionRow): Promise<void>;
  protected abstract findSession(tokenHash: string, now: number): Promise<SessionRow | undefined>;
  protected abstract deleteSession(tokenHash: string): Promise<void>;
  protected abstract deleteSessionsForOwner(ownerId: string): Promise<void>;
  protected abstract afterOwnerReady(ownerId: string): Promise<void>;

  async setupNeeded(): Promise<boolean> {
    if (selfhostOwnerResetRequested()) return true;
    const owners = await this.loadOwners();
    return !owners.some((owner) => owner.passwordHash);
  }

  async setup(input: unknown): Promise<OwnerSessionView> {
    const account = parseAccount(input);
    const owners = await this.loadOwners();
    const occupied = owners.filter((owner) => owner.passwordHash);
    if (occupied.length && !selfhostOwnerResetRequested()) throw new SetupClosedError();
    const passwordHash = await hashPassword(account.password);
    const claimed = occupied[0]
      ?? owners.find((owner) => owner.id === "selfhost-operator")
      ?? owners[0];
    const owner = claimed
      ? { ...claimed, email: account.email, passwordHash, displayName: account.displayName, state: "active" }
      : { id: randomUUID(), email: account.email, passwordHash, displayName: account.displayName, state: "active" };
    if (claimed) {
      await this.claimOwner(owner.id, account.email, passwordHash, account.displayName);
      await this.deleteSessionsForOwner(owner.id);
    } else {
      await this.insertOwner(owner);
    }
    await this.afterOwnerReady(owner.id);
    return this.issue(owner);
  }

  async login(input: unknown): Promise<OwnerSessionView> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new SelfhostValidationError("invalid account");
    }
    const body = input as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = normalizePassword(body.password);
    const owner = (await this.loadOwners()).find((row) => ownerEmailMatches(row.email, email) && row.passwordHash);
    if (!owner || owner.state !== "active" || !owner.passwordHash) {
      throw new UnauthorizedError("Email or password was rejected.");
    }
    if (!await passwordMatches(password, owner.passwordHash)) {
      throw new UnauthorizedError("Email or password was rejected.");
    }
    return this.issue(owner);
  }

  async ownerIdForAuthorization(authorization: string | undefined): Promise<string> {
    const session = await this.findSession(hashToken(bearerToken(authorization)), Date.now());
    if (!session) throw new UnauthorizedError();
    const owner = (await this.loadOwners()).find((row) => row.id === session.ownerId);
    if (!owner || owner.state !== "active") throw new UnauthorizedError();
    return owner.id;
  }

  async logout(authorization: string | undefined): Promise<void> {
    try {
      await this.deleteSession(hashToken(bearerToken(authorization)));
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
    }
  }

  private async issue(owner: OwnerRow): Promise<OwnerSessionView> {
    const access_token = mintSessionToken();
    await this.insertSession({
      id: randomUUID(),
      ownerId: owner.id,
      tokenHash: hashToken(access_token),
      expiresAt: Date.now() + sessionTtlMs
    });
    return {
      access_token,
      owner_id: owner.id,
      display_name: owner.displayName ?? "Owner"
    };
  }
}

export class MemorySelfhostOwner extends OwnerAuthBase {
  private readonly owners: OwnerRow[];
  private readonly sessions: SessionRow[] = [];

  constructor(owners: OwnerRow[] = []) {
    super();
    this.owners = owners.map((owner) => ({ ...owner }));
  }

  protected async loadOwners(): Promise<OwnerRow[]> {
    return this.owners.map((owner) => ({ ...owner }));
  }

  protected async insertOwner(owner: OwnerRow): Promise<void> {
    this.owners.push({ ...owner });
  }

  protected async claimOwner(id: string, email: string, passwordHash: string, displayName: string): Promise<void> {
    const owner = this.owners.find((row) => row.id === id);
    if (!owner) throw new Error("missing owner");
    owner.email = email;
    owner.passwordHash = passwordHash;
    owner.displayName = displayName;
    owner.state = "active";
  }

  protected async insertSession(session: SessionRow): Promise<void> {
    this.sessions.push({ ...session });
  }

  protected async findSession(tokenHash: string, now: number): Promise<SessionRow | undefined> {
    return this.sessions.find((session) => session.tokenHash === tokenHash && session.expiresAt > now);
  }

  protected async deleteSession(tokenHash: string): Promise<void> {
    const index = this.sessions.findIndex((session) => session.tokenHash === tokenHash);
    if (index >= 0) this.sessions.splice(index, 1);
  }

  protected async deleteSessionsForOwner(ownerId: string): Promise<void> {
    for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
      if (this.sessions[index]?.ownerId === ownerId) this.sessions.splice(index, 1);
    }
  }

  protected async afterOwnerReady(): Promise<void> {}
}

export class PostgresSelfhostOwner extends OwnerAuthBase {
  constructor(
    private readonly pool: Pool,
    private readonly grants?: { ensureFreeGrant(ownerId: string): Promise<void> }
  ) {
    super();
  }

  protected async loadOwners(): Promise<OwnerRow[]> {
    const result = await this.pool.query<{
      id: string;
      email: string | null;
      passwordHash: string | null;
      displayName: string | null;
      state: string;
    }>(`SELECT id, email, "passwordHash", "displayName", state::text AS state FROM "User"`);
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email ?? undefined,
      passwordHash: row.passwordHash ?? undefined,
      displayName: row.displayName ?? undefined,
      state: row.state
    }));
  }

  protected async insertOwner(owner: OwnerRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO "User" (id, state, email, "passwordHash", "displayName")
       VALUES ($1, 'active', $2, $3, $4)`,
      [owner.id, owner.email, owner.passwordHash, owner.displayName]
    );
  }

  protected async claimOwner(id: string, email: string, passwordHash: string, displayName: string): Promise<void> {
    await this.pool.query(
      `UPDATE "User"
          SET state = 'active', email = $2, "passwordHash" = $3, "displayName" = $4
        WHERE id = $1`,
      [id, email, passwordHash, displayName]
    );
  }

  protected async insertSession(session: SessionRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO "OwnerSession" (id, "ownerId", "tokenHash", "expiresAt")
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
      [session.id, session.ownerId, session.tokenHash, session.expiresAt]
    );
  }

  protected async findSession(tokenHash: string, now: number): Promise<SessionRow | undefined> {
    const result = await this.pool.query<{ id: string; ownerId: string; tokenHash: string; expiresAt: Date }>(
      `SELECT id, "ownerId", "tokenHash", "expiresAt"
         FROM "OwnerSession"
        WHERE "tokenHash" = $1 AND "expiresAt" > to_timestamp($2 / 1000.0)`,
      [tokenHash, now]
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, ownerId: row.ownerId, tokenHash: row.tokenHash, expiresAt: row.expiresAt.getTime() }
      : undefined;
  }

  protected async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query(`DELETE FROM "OwnerSession" WHERE "tokenHash" = $1`, [tokenHash]);
  }

  protected async deleteSessionsForOwner(ownerId: string): Promise<void> {
    await this.pool.query(`DELETE FROM "OwnerSession" WHERE "ownerId" = $1`, [ownerId]);
  }

  protected async afterOwnerReady(ownerId: string): Promise<void> {
    await this.grants?.ensureFreeGrant(ownerId);
  }
}
