import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "./helpers/mockPrisma.js";

const mockVerifyShopifyWebhookHmac = vi.fn();
const mockGetShopifyWebhookHeaders = vi.fn();
const mockSafeCreateAdminAuditLog = vi.fn();
const mockLogAuditInfo = vi.fn();

vi.mock("@/lib/shopifyWebhook", () => ({
  getShopifyWebhookHeaders: (...args) => mockGetShopifyWebhookHeaders(...args),
  verifyShopifyWebhookHmac: (...args) => mockVerifyShopifyWebhookHmac(...args),
}));

vi.mock("@/lib/adminAudit", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    safeCreateAdminAuditLog: (...args) => mockSafeCreateAdminAuditLog(...args),
  };
});

vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logAuditInfo: (...args) => mockLogAuditInfo(...args),
  };
});

import {
  createWebhookAuditLog,
  getWebhookMerchant,
  parseWebhookJson,
  readRawBody,
  sanitizeWebhookAuditMetadata,
  verifyIncomingShopifyWebhook,
} from "@/lib/shopifyWebhookHandlers";

describe("shopifyWebhookHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetShopifyWebhookHeaders.mockReturnValue({
      hmac: "test-hmac",
      shopDomain: "Demo.myshopify.com",
      topic: "orders/create",
      webhookId: "1",
    });
    mockSafeCreateAdminAuditLog.mockResolvedValue({ id: "audit-1" });
  });

  it("reads raw request body as text", async () => {
    const request = new Request("http://localhost/api/webhooks/orders-create", {
      method: "POST",
      body: '{"id":123}',
    });

    await expect(readRawBody(request)).resolves.toBe('{"id":123}');
  });

  it("verifies incoming webhook HMAC before trusting payload", () => {
    mockVerifyShopifyWebhookHmac.mockReturnValue({
      valid: false,
      error: "Invalid webhook HMAC",
    });

    const request = new Request("http://localhost/api/webhooks/orders-create", {
      method: "POST",
    });

    expect(verifyIncomingShopifyWebhook(request, '{"id":123}')).toEqual({
      valid: false,
      shopDomain: "demo.myshopify.com",
      error: "Invalid webhook HMAC",
    });
    expect(mockVerifyShopifyWebhookHmac).toHaveBeenCalledWith(
      '{"id":123}',
      "test-hmac",
    );
  });

  it("parses valid webhook JSON safely", () => {
    expect(parseWebhookJson('{"id":123}')).toEqual({
      success: true,
      data: { id: 123 },
      error: null,
    });
  });

  it("returns generic error for invalid JSON", () => {
    expect(parseWebhookJson("{bad json")).toEqual({
      success: false,
      data: null,
      error: "Invalid webhook payload",
    });
  });

  it("loads active merchant by shop domain", async () => {
    const merchant = {
      id: "merchant-1",
      shopDomain: "demo.myshopify.com",
      shopName: "Demo",
      isActive: true,
    };
    mockPrisma.merchant.findFirst.mockResolvedValue(merchant);

    await expect(getWebhookMerchant("demo.myshopify.com")).resolves.toEqual(
      merchant,
    );
    expect(mockPrisma.merchant.findFirst).toHaveBeenCalledWith({
      where: {
        shopDomain: "demo.myshopify.com",
        isActive: true,
      },
      select: {
        id: true,
        shopDomain: true,
        shopName: true,
        isActive: true,
      },
    });
  });

  it("strips PII from webhook audit metadata", () => {
    expect(
      sanitizeWebhookAuditMetadata({
        shopDomain: "demo.myshopify.com",
        email: "secret@example.com",
        payload: { id: 1 },
      }),
    ).toEqual({
      shopDomain: "demo.myshopify.com",
    });
  });

  it("creates merchant-scoped audit logs without PII", async () => {
    await createWebhookAuditLog({
      merchantId: "merchant-1",
      action: "WEBHOOK_PROCESSED",
      metadata: {
        shopDomain: "demo.myshopify.com",
        topic: "orders/create",
        email: "secret@example.com",
      },
    });

    expect(mockLogAuditInfo).toHaveBeenCalledWith("WEBHOOK_PROCESSED", {
      shopDomain: "demo.myshopify.com",
      topic: "orders/create",
    });
    expect(mockSafeCreateAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant-1",
        eventType: "WEBHOOK_PROCESSED",
        metadata: {
          shopDomain: "demo.myshopify.com",
          topic: "orders/create",
        },
      }),
    );
  });

  it("skips admin audit log when merchantId is missing", async () => {
    await createWebhookAuditLog({
      action: "WEBHOOK_PROCESSED",
      metadata: { shopDomain: "demo.myshopify.com" },
    });

    expect(mockLogAuditInfo).toHaveBeenCalled();
    expect(mockSafeCreateAdminAuditLog).not.toHaveBeenCalled();
  });
});
