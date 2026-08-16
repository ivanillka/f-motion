-- Historical GenerationJob rows must survive ProviderCredential DELETE (plan 052).
ALTER TABLE "GenerationJob"
  DROP CONSTRAINT "GenerationJob_credentialId_fkey";

ALTER TABLE "GenerationJob"
  ALTER COLUMN "credentialId" DROP NOT NULL;

ALTER TABLE "GenerationJob"
  ADD CONSTRAINT "GenerationJob_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "ProviderCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;
