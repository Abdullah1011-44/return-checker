-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "shopifyOrderId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "shopifyLineItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrder_merchantId_shopifyOrderId_key" ON "CustomerOrder"("merchantId", "shopifyOrderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "OrderItem_orderId_shopifyLineItemId_key" ON "OrderItem"("orderId", "shopifyLineItemId");
