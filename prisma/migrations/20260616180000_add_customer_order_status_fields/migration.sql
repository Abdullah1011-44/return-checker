-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "financialStatus" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "fulfillmentStatus" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
