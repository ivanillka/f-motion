export type ProductFlavor = "selfhost" | "hosted" | "corporate";

const hostedOnlyNames = [
  "SUPABASE_ISSUER",
  "SUPABASE_JWKS_URL",
  "SUPABASE_AUDIENCE",
  "SUPABASE_ISSUER_EXTRA",
  "SUPABASE_JWKS_URL_EXTRA",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_API_KEY"
] as const;

export function engineEnv(env: Record<string, string | undefined>): string | undefined {
  return env.FENGINE_ENV?.trim() || env.FMOTION_ENV?.trim() || undefined;
}

export function productFlavor(env: Record<string, string | undefined>): ProductFlavor | undefined {
  const value = engineEnv(env);
  if (!value) return undefined;
  if (value === "selfhost" || value === "hosted" || value === "corporate") return value;
  throw new Error(`unknown FENGINE_ENV=${value}`);
}

/**
 * Product adapters only. Core studio code must not import this module.
 * Three products, three contracts. Do not leak hosted payment/Supabase into
 * the VPS image, and do not boot a teams product that does not exist yet.
 */
export function assertProductIsolation(env: Record<string, string | undefined>): ProductFlavor | undefined {
  const flavor = productFlavor(env);
  if (flavor === "corporate") {
    throw new Error("FENGINE_ENV=corporate is reserved for the internal teams product and is not built yet");
  }
  if (flavor === "selfhost") {
    for (const name of hostedOnlyNames) {
      if (env[name]?.trim()) throw new Error(`${name} belongs to f-motion.com, not the VPS product`);
    }
    if (env.FENGINE_ACCESS_MODE === "invite_only") {
      throw new Error("invite_only belongs to f-motion.com, not the VPS product");
    }
  }
  if (flavor === "hosted") {
    const leftover = env.FENGINE_BOOTSTRAP_TOKEN?.trim() || env.FMOTION_BOOTSTRAP_TOKEN?.trim();
    if (leftover) throw new Error("bootstrap tokens are not used on f-motion.com");
  }
  return flavor;
}
