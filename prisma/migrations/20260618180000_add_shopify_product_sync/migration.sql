-- CreateTable
CREATE TABLE "ShopifyProduct" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "shopifyProductGid" TEXT NOT NULL,
    "shopifyProductLegacyId" TEXT,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "vendor" TEXT,
    "productType" TEXT,
    "status" TEXT,
    "tags" TEXT,
    "featuredImageUrl" TEXT,
    "onlineStoreUrl" TEXT,
    "totalInventory" INTEGER,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyProductVariant" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyVariantGid" TEXT NOT NULL,
    "shopifyVariantLegacyId" TEXT,
    "title" TEXT NOT NULL,
    "displayName" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "price" TEXT,
    "compareAtPrice" TEXT,
    "inventoryQuantity" INTEGER,
    "availableForSale" BOOLEAN,
    "selectedOptions" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyProduct_merchantId_shopifyProductGid_key" ON "ShopifyProduct"("merchantId", "shopifyProductGid");

-- CreateIndex
CREATE INDEX "ShopifyProduct_merchantId_idx" ON "ShopifyProduct"("merchantId");

-- CreateIndex
CREATE INDEX "ShopifyProduct_merchantId_shopifyProductLegacyId_idx" ON "ShopifyProduct"("merchantId", "shopifyProductLegacyId");

-- CreateIndex
CREATE INDEX "ShopifyProduct_merchantId_handle_idx" ON "ShopifyProduct"("merchantId", "handle");

-- CreateIndex
CREATE INDEX "ShopifyProduct_merchantId_productType_idx" ON "ShopifyProduct"("merchantId", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyProductVariant_merchantId_shopifyVariantGid_key" ON "ShopifyProductVariant"("merchantId", "shopifyVariantGid");

-- CreateIndex
CREATE INDEX "ShopifyProductVariant_merchantId_idx" ON "ShopifyProductVariant"("merchantId");

-- CreateIndex
CREATE INDEX "ShopifyProductVariant_merchantId_shopifyVariantLegacyId_idx" ON "ShopifyProductVariant"("merchantId", "shopifyVariantLegacyId");

-- CreateIndex
CREATE INDEX "ShopifyProductVariant_merchantId_sku_idx" ON "ShopifyProductVariant"("merchantId", "sku");

-- CreateIndex
CREATE INDEX "ShopifyProductVariant_productId_idx" ON "ShopifyProductVariant"("productId");

-- AddForeignKey
ALTER TABLE "ShopifyProduct" ADD CONSTRAINT "ShopifyProduct_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyProductVariant" ADD CONSTRAINT "ShopifyProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopifyProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
