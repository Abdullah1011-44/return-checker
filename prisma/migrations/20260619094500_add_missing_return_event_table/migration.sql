-- Repair migration history drift.
-- ReturnEvent exists in the current Prisma schema and real database,
-- but was missing from earlier migration history before index creation.

CREATE TABLE IF NOT EXISTS "ReturnEvent" (
  "id" TEXT NOT NULL,
  "returnRequestId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorType" TEXT NOT NULL DEFAULT 'system',
  "eventType" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReturnEvent_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ReturnEvent_returnRequestId_fkey'
  ) THEN
    ALTER TABLE "ReturnEvent"
    ADD CONSTRAINT "ReturnEvent_returnRequestId_fkey"
    FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'ReturnEvent_actorUserId_fkey'
  ) THEN
    ALTER TABLE "ReturnEvent"
    ADD CONSTRAINT "ReturnEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "MerchantUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ReturnEvent_returnRequestId_idx" ON "ReturnEvent"("returnRequestId");
CREATE INDEX IF NOT EXISTS "ReturnEvent_actorUserId_idx" ON "ReturnEvent"("actorUserId");
CREATE INDEX IF NOT EXISTS "ReturnEvent_eventType_idx" ON "ReturnEvent"("eventType");
CREATE INDEX IF NOT EXISTS "ReturnEvent_createdAt_idx" ON "ReturnEvent"("createdAt");
