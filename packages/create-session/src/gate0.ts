import type { MediaSourcePref } from "@f-engine/content-type-contract";

export type ByokProvider = "pexels" | "fal";

export interface ByokKeyPresence {
  pexels: boolean;
  fal: boolean;
}

export class Gate0Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Gate0Error";
  }
}

/**
 * Gate 0 / BYOK edge checks for create-flow.
 * Deny managed AI/music claims; require owner keys for stock/FAL paths.
 */
export class Gate0Policy {
  constructor(readonly keys: ByokKeyPresence = { pexels: false, fal: false }) {}

  assertNoManagedAiClaim(claim: string): void {
    const text = claim.normalize("NFKC").toLowerCase();
    if (/\b(managed|platform|included)\s+(ai|llm|whisper|gemini|claude|chatgpt)\b/u.test(text)) {
      throw new Gate0Error("managed AI claims are denied under Gate 0");
    }
    if (/\b(beatoven|managed music|ai music credits)\b/u.test(text)) {
      throw new Gate0Error("managed music is denied under Gate 0");
    }
  }

  requireByok(provider: ByokProvider): void {
    if (provider === "pexels" && !this.keys.pexels) {
      throw new Gate0Error("Pexels BYOK key required");
    }
    if (provider === "fal" && !this.keys.fal) {
      throw new Gate0Error("FAL BYOK key required");
    }
  }

  /** Media prefs that spend owner keys must have those keys present. */
  assertMediaSourcePref(pref: MediaSourcePref): void {
    if (pref === "pexels" || pref === "mix") this.requireByok("pexels");
    if (pref === "fal" || pref === "mix") this.requireByok("fal");
  }

  /** FAL spend requires an explicit confirmed quote id on the session catalog. */
  assertFalQuoteConfirmed(quoteIds: readonly string[], confirmedId: string): void {
    this.requireByok("fal");
    if (!confirmedId.trim() || !quoteIds.includes(confirmedId)) {
      throw new Gate0Error("FAL quote must be confirmed before spend");
    }
  }
}
