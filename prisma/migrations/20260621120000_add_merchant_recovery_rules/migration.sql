-- CreateEnum
CREATE TYPE "RecoveryRuleType" AS ENUM ('EXCHANGE', 'STORE_CREDIT', 'PARTIAL_REFUND', 'MANUAL_REVIEW');

-- CreateTable
CREATE TABLE "MerchantRecoveryRule" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "RecoveryRuleType" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantRecoveryRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantRecoveryRule_merchantId_idx" ON "MerchantRecoveryRule"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantRecoveryRule_merchantId_enabled_idx" ON "MerchantRecoveryRule"("merchantId", "enabled");

-- CreateIndex
CREATE INDEX "MerchantRecoveryRule_merchantId_priority_idx" ON "MerchantRecoveryRule"("merchantId", "priority");

-- CreateIndex
CREATE INDEX "MerchantRecoveryRule_merchantId_type_idx" ON "MerchantRecoveryRule"("merchantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRecoveryRule_merchantId_type_key" ON "MerchantRecoveryRule"("merchantId", "type");

-- AddForeignKey
ALTER TABLE "MerchantRecoveryRule" ADD CONSTRAINT "MerchantRecoveryRule_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
