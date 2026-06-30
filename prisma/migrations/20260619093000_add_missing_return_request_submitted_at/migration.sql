-- Repair migration history drift.
-- This column exists in the current Prisma schema and real database,
-- but was missing from earlier migration history before index creation.

ALTER TABLE "ReturnRequest" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
