export const providerCapabilities = {
  pexels: ["stock_video", "stock_still"],
  pixabay: ["stock_video", "stock_still"],
  fal: ["ai_image", "ai_video", "speech"]
} as const;

export type ProviderId = keyof typeof providerCapabilities;
export type ProviderCapability = (typeof providerCapabilities)[ProviderId][number];

export interface ProviderListing {
  id: ProviderId;
  label: string;
  enabled: boolean;
  connected: boolean;
  capabilities: readonly ProviderCapability[];
  hint?: string;
  validated_at?: string;
}

const labels: Record<ProviderId, string> = {
  pexels: "Pexels",
  pixabay: "Pixabay",
  fal: "FAL"
};

export function listProviderIds(): ProviderId[] {
  return ["pexels", "pixabay", "fal"];
}

export function providerListing(
  id: ProviderId,
  status: { connected: boolean; hint?: string; validated_at?: string } | undefined,
  enabled: boolean
): ProviderListing {
  return {
    id,
    label: labels[id],
    enabled,
    connected: Boolean(enabled && status?.connected),
    capabilities: providerCapabilities[id],
    ...(status?.hint ? { hint: status.hint } : {}),
    ...(status?.validated_at ? { validated_at: status.validated_at } : {})
  };
}

export function listingHasCapability(providers: readonly ProviderListing[], capability: ProviderCapability): boolean {
  return providers.some((provider) => provider.connected && provider.capabilities.includes(capability));
}
