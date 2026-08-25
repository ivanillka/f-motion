ALTER TABLE "ProviderCredential"
  DROP CONSTRAINT "ProviderCredential_provider_check";

ALTER TABLE "ProviderCredential"
  ADD CONSTRAINT "ProviderCredential_provider_check"
  CHECK (provider IN ('fal', 'pexels', 'pixabay'));
