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

import {
  getFulfillmentOrderUpdateFields,
  mapOrderStatusFromFulfillment,
  POST,
} from "@/app/api/webhooks/fulfillments-create/route";

describe("fulfillments-create webhook route", () => {
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
        id: 9001,
        order_id: 5001,
        status: "success",
        shipment_status: "delivered",
        tracking_number: "SECRET-TRACKING",
        destination: { address1: "123 Main St" },
      },
      error: null,
    });
    mockPrisma.customerOrder.findUnique.mockResolvedValue({
      id: "order-1",
      merchantId: "merchant-1",
      shopifyOrderId: "5001",
      status: "PAID",
      fulfillmentStatus: null,
    });
    mockPrisma.customerOrder.update.mockResolvedValue({ id: "order-1" });
  });

  it("maps delivered shipment status to DELIVERED", () => {
    expect(
      mapOrderStatusFromFulfillment({
        shipmentStatus: "delivered",
        fulfillmentStatus: "success",
      })
    ).toBe("DELIVERED");
  });

  it("maps successful fulfillment to FULFILLED when not delivered", () => {
    expect(
      getFulfillmentOrderUpdateFields(
        {
          status: "PAID",
          fulfillmentStatus: null,
        },
        {
          fulfillmentStatus: "success",
          shipmentStatus: "in_transit",
        }
      )
    ).toEqual({
      fulfillmentStatus: "fulfilled",
      status: "FULFILLED",
    });
  });

  it("returns ignored success when order is missing", async () => {
    mockPrisma.customerOrder.findUnique.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/webhooks/fulfillments-create", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ignored: true });
    expect(mockPrisma.customerOrder.update).not.toHaveBeenCalled();
  });

  it("updates order fulfillment status and audits webhook processing", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/fulfillments-create", {
        method: "POST",
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockPrisma.customerOrder.update).toHaveBeenCalledWith({
      where: { id: "order-1" },
      data: {
        fulfillmentStatus: "fulfilled",
        status: "DELIVERED",
      },
    });
    expect(mockCreateWebhookAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "FULFILLMENT_CREATED_WEBHOOK",
        metadata: {
          shopDomain: "demo.myshopify.com",
          shopifyOrderId: "5001",
          fulfillmentStatus: "fulfilled",
          shipmentStatus: "delivered",
          source: "shopify_webhook",
        },
      })
    );
  });
});
