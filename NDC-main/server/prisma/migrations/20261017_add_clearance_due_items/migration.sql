-- =========================================================================
-- COMPATIBLE SCHEMA EXTENSION: MULTIPLE OUTSTANDING DUES PER CLEARANCE
-- =========================================================================
-- Design for granular itemized dues without executing destructive operations
-- on production databases.
--
-- Note: In the existing database, multi-due accumulation and itemization are
-- safely handled by DueManagementService by accumulating dueAmount and
-- preserving itemized history within dueDetails. This migration provides the
-- relational child table specification for future dedicated query decoupling.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "clearance_due_items" (
    "id" TEXT NOT NULL,
    "clearanceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LOGBOOK_OCR',
    "sourceEntryId" TEXT,
    "recordedById" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clearance_due_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clearance_due_items_clearanceId_fkey" FOREIGN KEY ("clearanceId") REFERENCES "ndc_clearances"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clearance_due_items_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "clearance_due_items_idempotencyKey_key" ON "clearance_due_items"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "clearance_due_items_clearanceId_idx" ON "clearance_due_items"("clearanceId");
CREATE INDEX IF NOT EXISTS "clearance_due_items_sourceEntryId_idx" ON "clearance_due_items"("sourceEntryId");
CREATE INDEX IF NOT EXISTS "clearance_due_items_createdAt_idx" ON "clearance_due_items"("createdAt");
