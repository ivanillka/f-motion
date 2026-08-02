CREATE TABLE "ProviderCredential" (
  id TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,
  nonce BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  hint TEXT NOT NULL,
  "validatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderCredential_provider_check" CHECK (provider = 'fal'),
  CONSTRAINT "ProviderCredential_nonce_length_check" CHECK (octet_length(nonce) = 12),
  CONSTRAINT "ProviderCredential_auth_tag_length_check" CHECK (octet_length("authTag") = 16),
  CONSTRAINT "ProviderCredential_key_version_check" CHECK ("keyVersion" > 0),
  CONSTRAINT "ProviderCredential_hint_length_check" CHECK (char_length(hint) BETWEEN 1 AND 4),
  UNIQUE ("ownerId", provider)
);

CREATE INDEX "ProviderCredential_ownerId_idx" ON "ProviderCredential" ("ownerId");
