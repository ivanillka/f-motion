import type { CreateSession } from "./session.js";

/** ponytail: in-memory ceiling for spine PR; upgrade to Prisma CreateSession table when API persists. */
export class MemoryCreateSessionStore {
  readonly #sessions = new Map<string, CreateSession>();

  put(session: CreateSession): CreateSession {
    const copy = structuredClone(session);
    this.#sessions.set(copy.id, copy);
    return structuredClone(copy);
  }

  get(id: string): CreateSession | undefined {
    const found = this.#sessions.get(id);
    return found ? structuredClone(found) : undefined;
  }

  require(id: string): CreateSession {
    const found = this.get(id);
    if (!found) throw new Error(`unknown create session: ${id}`);
    return found;
  }

  delete(id: string): boolean {
    return this.#sessions.delete(id);
  }

  listForOwner(ownerId: string): CreateSession[] {
    return [...this.#sessions.values()]
      .filter((session) => session.ownerId === ownerId)
      .map((session) => structuredClone(session));
  }
}
