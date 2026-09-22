-- Balance history (GET /api/groups/[groupId]/balance-history) reads a group's
-- audit entries by the expenses they describe: entityType = 'transaction' AND
-- entityId IN (...). Without an index that is a scan of every group's history.
-- The table is small, so a plain CREATE INDEX holds its write lock for
-- milliseconds; a large table would need CREATE INDEX CONCURRENTLY instead, so
-- that writes carry on while it builds.

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

