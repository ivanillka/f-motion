CREATE INDEX "WorkOutbox_undispatched_createdAt_idx"
  ON "WorkOutbox" ("createdAt")
  WHERE "dispatchedAt" IS NULL;
