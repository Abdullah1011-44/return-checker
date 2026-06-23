import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "./helpers/mockPrisma.js";

const mockReadRawBody = vi.fn();
const mockVerifyIncomingShopifyWebhook = vi.fn();
const mockParseWebhookJson = vi.fn();
const mockGetWebhookMerchant = vi.fn();
const mockCreateWebhookAuditLog = vi.fn();
const mockLogWebhookInvalidHmac = vi.fn();

vi.mock("@/lib/shopifyWebhookHandlers", () => ({
  readRawBody: (...args) => mockReadRawBody(...args),
  verifyIncomingShopifyWebhook: (...args) =>
    mockVerifyIncomingShopifyWebhook(...args),
  parseWebhookJson: (...args) => mockParseWebhookJson(...args),
  getWebhookMerchant: (...args) => mockGetWebhookMerchant(...args),
  createWebhookAuditLog: (...args) => mockCreateWebhookAuditLog(...args),
}));

vi.mock("@/lib/shopifyComplianceWebhook", () => ({
  logWebhookInvalidHmac: (...args) => mockLogWebhookInvalidHmac(...args),
}));

vi.mock("@/lib/sentry", () => ({
  captureException: vi.fn(),
}));

import { POST } from "@/app/api/webhooks/orders-updated/route";

describe("orders-updated webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadRawBody.mockResolvedValue("{}");
    mockVerifyIncomingShopifyWebhook.mockReturnValue({
      valid: true,
      shopDomain: "demo.myshopify.com",
      error: null,
    });
    mockGetWebhookMerchant.mockResolvedValue({
      id: "merchant-1",
      shopDomain: "demo.myshopify.com",
      isActive: true,
    });
    mockParseWebhookJson.mockReturnValue({
      success: true,
      data: {
        id: 5001,
        name: "#5001",
        total_price: "59.00",
        currency: "USD",
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        cancelled_at: null,
      },
      error: null,
    });
    mockPrisma.customerOrder.findUnique.mockResolvedValue({
      id: "order-1",
      merchantId: "merchant-1",
      shopifyOrderId: "5001",
      orderNumber: "5001",
      totalAmount: "49.00",
      currency: "USD",
      status: "PAID",
      financialStatus: "paid",
      fulfillmentStatus: null,
      cancelledAt: null,
    });
    mockPrisma.customerOrder.update.mockResolvedValue({ id: "order-1" });
  });

  it("returns 401 for invalid HMAC", async () => {
    mockVerifyIncomingShopifyWebhook.mockReturnValue({
      valid: false,
      shopDomain: "demo.myshopify.com",
      error: "Invalid webhook HMAC",
    });

    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-updated", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns ignored success when order is not found", async () => {
    mockPrisma.customerOrder.findUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-updated", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ignored: true });
    expect(mockPrisma.customerOrder.update).not.toHaveBeenCalled();
    expect(mockCreateWebhookAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ORDER_UPDATED_WEBHOOK_IGNORED",
      })
    );
  });

  it("updates safe order fields for an existing merchant order", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-updated", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockPrisma.customerOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        status: "FULFILLED",
        fulfillmentStatus: "fulfilled",
        totalAmount: "59.00",
      },
    });
    expect(mockCreateWebhookAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ORDER_UPDATED_WEBHOOK",
        metadata: {
          shopDomain: "demo.myshopify.com",
          shopifyOrderId: "5001",
          orderNumber: "5001",
          status: "FULFILLED",
          source: "shopify_webhook",
        },
      })
    );
  });

  it("falls back to merchantId + orderNumber lookup", async () => {
    mockPrisma.customerOrder.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "order-2",
        merchantId: "merchant-1",
        shopifyOrderId: null,
        orderNumber: "5001",
        totalAmount: "49.00",
        currency: "USD",
        status: "PENDING",
        financialStatus: "pending",
        fulfillmentStatus: null,
        cancelledAt: null,
      });

    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-updated", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.customerOrder.findUnique).toHaveBeenNthCalledWith(2, {
      where: {
        merchantId_orderNumber: {
          merchantId: "merchant-1",
          orderNumber: "5001",
        },
      },
    });
    expect(mockPrisma.customerOrder.update).toHaveBeenCalled();
  });
});
