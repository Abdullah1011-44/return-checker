-- CreateIndex
CREATE INDEX "idx_merchant_active_shop_domain" ON "Merchant"("isActive", "shopDomain");

-- CreateIndex
CREATE INDEX "idx_merchant_active_updated_at" ON "Merchant"("isActive", "updatedAt");

-- CreateIndex
CREATE INDEX "idx_return_request_merchant_submitted" ON "ReturnRequest"("merchantId", "submittedAt");

-- CreateIndex
CREATE INDEX "idx_return_request_merchant_status_submitted" ON "ReturnRequest"("merchantId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "idx_return_request_email_submitted" ON "ReturnRequest"("customerEmail", "submittedAt");

-- CreateIndex
CREATE INDEX "idx_return_event_request_created" ON "ReturnEvent"("returnRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_admin_audit_merchant_created" ON "AdminAuditLog"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "idx_admin_audit_merchant_event_created" ON "AdminAuditLog"("merchantId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "idx_admin_audit_actor_created" ON "AdminAuditLog"("actorUserId", "createdAt");
