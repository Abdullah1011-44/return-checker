-- CreateTable
CREATE TABLE "ReturnOfferAcceptance" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "returnItemId" TEXT NOT NULL,
    "originalRequestedOption" TEXT,
    "acceptedOfferType" TEXT NOT NULL,
    "offerSource" TEXT NOT NULL,
    "recoveryAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "legalReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnOfferAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnOfferAcceptance_returnItemId_key" ON "ReturnOfferAcceptance"("returnItemId");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_merchantId_idx" ON "ReturnOfferAcceptance"("merchantId");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_returnRequestId_idx" ON "ReturnOfferAcceptance"("returnRequestId");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_returnItemId_idx" ON "ReturnOfferAcceptance"("returnItemId");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_acceptedOfferType_idx" ON "ReturnOfferAcceptance"("acceptedOfferType");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_offerSource_idx" ON "ReturnOfferAcceptance"("offerSource");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_legalReviewRequired_idx" ON "ReturnOfferAcceptance"("legalReviewRequired");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_acceptedAt_idx" ON "ReturnOfferAcceptance"("acceptedAt");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_merchantId_acceptedAt_idx" ON "ReturnOfferAcceptance"("merchantId", "acceptedAt");

-- CreateIndex
CREATE INDEX "ReturnOfferAcceptance_merchantId_acceptedOfferType_idx" ON "ReturnOfferAcceptance"("merchantId", "acceptedOfferType");

-- AddForeignKey
ALTER TABLE "ReturnOfferAcceptance" ADD CONSTRAINT "ReturnOfferAcceptance_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOfferAcceptance" ADD CONSTRAINT "ReturnOfferAcceptance_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOfferAcceptance" ADD CONSTRAINT "ReturnOfferAcceptance_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "ReturnItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
