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

import { POST } from "@/app/api/webhooks/orders-create/route";
import { extractSafeShopifyOrderFields } from "@/app/api/webhooks/orders-create/route";

describe("orders-create webhook route", () => {
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
        total_price: "49.00",
        currency: "USD",
        financial_status: "paid",
        fulfillment_status: null,
        created_at: "2026-06-16T12:00:00Z",
      },
      error: null,
    });
    mockPrisma.customerOrder.findUnique.mockResolvedValue(null);
    mockPrisma.customerOrder.create.mockResolvedValue({ id: "order-1" });
  });

  it("extracts only safe Shopify order fields", () => {
    expect(
      extractSafeShopifyOrderFields({
        id: 5001,
        name: "#5001",
        total_price: "49.00",
        currency: "USD",
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        created_at: "2026-06-16T12:00:00Z",
        email: "secret@example.com",
        customer: { first_name: "Jane" },
      })
    ).toEqual({
      shopifyOrderId: "5001",
      orderNumber: "5001",
      totalPrice: "49.00",
      currency: "USD",
      orderedAt: new Date("2026-06-16T12:00:00Z"),
      status: "FULFILLED",
      financialStatus: "paid",
      fulfillmentStatus: "fulfilled",
      cancelledAt: null,
    });
  });

  it("returns 401 for invalid HMAC", async () => {
    mockVerifyIncomingShopifyWebhook.mockReturnValue({
      valid: false,
      shopDomain: "demo.myshopify.com",
      error: "Invalid webhook HMAC",
    });

    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-create", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockParseWebhookJson).not.toHaveBeenCalled();
  });

  it("returns ignored success for unknown merchant", async () => {
    mockGetWebhookMerchant.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-create", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ignored: true });
    expect(mockParseWebhookJson).not.toHaveBeenCalled();
  });

  it("creates a new customer order for the merchant", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-create", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockPrisma.customerOrder.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        merchantId: "merchant-1",
        shopifyOrderId: "5001",
        orderNumber: "5001",
        totalAmount: "49.00",
        currency: "USD",
        status: "PAID",
        financialStatus: "paid",
        customerEmail: "shopify-order-5001@placeholder.returnradar.local",
        customerName: "Shopify Customer",
        customerPhone: null,
      }),
    });
    expect(mockCreateWebhookAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant-1",
        action: "ORDER_CREATED_WEBHOOK",
        metadata: {
          shopDomain: "demo.myshopify.com",
          shopifyOrderId: "5001",
          orderNumber: "5001",
          source: "shopify_webhook",
        },
      })
    );
  });

  it("updates status fields only when order already exists", async () => {
    mockPrisma.customerOrder.findUnique.mockResolvedValue({
      id: "order-1",
      merchantId: "merchant-1",
      shopifyOrderId: "5001",
      status: "PENDING",
      financialStatus: "pending",
      fulfillmentStatus: null,
      cancelledAt: null,
    });
    mockParseWebhookJson.mockReturnValue({
      success: true,
      data: {
        id: 5001,
        name: "#5001",
        financial_status: "paid",
        fulfillment_status: null,
      },
      error: null,
    });

    const response = await POST(
      new Request("http://localhost/api/webhooks/orders-create", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockPrisma.customerOrder.create).not.toHaveBeenCalled();
    expect(mockPrisma.customerOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        status: "PAID",
        financialStatus: "paid",
      },
    });
    expect(mockCreateWebhookAuditLog).not.toHaveBeenCalled();
  });
});
