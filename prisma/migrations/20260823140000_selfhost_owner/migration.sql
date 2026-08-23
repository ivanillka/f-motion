-- Single-owner self-host account + browser sessions. Hosted JWT users leave these null.

ALTER TABLE "User" ADD COLUMN email TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "displayName" TEXT;

CREATE UNIQUE INDEX "User_email_lower_uidx"
  ON "User" (lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_email_length_check"
  CHECK (email IS NULL OR char_length(email) BETWEEN 3 AND 254);
ALTER TABLE "User" ADD CONSTRAINT "User_displayName_length_check"
  CHECK ("displayName" IS NULL OR char_length("displayName") BETWEEN 1 AND 64);

CREATE TABLE "OwnerSession" (
  id TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "OwnerSession_ownerId_idx" ON "OwnerSession" ("ownerId");
