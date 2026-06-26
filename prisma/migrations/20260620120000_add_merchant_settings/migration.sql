-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('GENERAL', 'FASHION', 'ELECTRONICS', 'BEAUTY', 'HOME', 'FOOD', 'OTHER');

-- CreateTable
CREATE TABLE "MerchantSettings" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "notifyEmail" TEXT,
    "returnWindow" INTEGER NOT NULL DEFAULT 30,
    "autoRejectDays" INTEGER,
    "aiConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "storeType" "StoreType" NOT NULL DEFAULT 'GENERAL',
    "allowExchange" BOOLEAN NOT NULL DEFAULT true,
    "allowKeepItem" BOOLEAN NOT NULL DEFAULT false,
    "allowPartialRefund" BOOLEAN NOT NULL DEFAULT true,
    "allowStoreCredit" BOOLEAN NOT NULL DEFAULT true,
    "freeExchangeShipping" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_merchantId_key" ON "MerchantSettings"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantSettings_merchantId_idx" ON "MerchantSettings"("merchantId");

-- AddForeignKey
ALTER TABLE "MerchantSettings" ADD CONSTRAINT "MerchantSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
