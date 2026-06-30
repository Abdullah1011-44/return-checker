-- Repair migration history drift.
-- These columns exist in the current Prisma schema and real database,
-- but were missing from earlier migration history before index creation.

ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Merchant" ADD COLUMN IF NOT EXISTS "shopDomain" TEXT;
