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

import { POST } from "@/app/api/webhooks/products-update/route";

describe("products-update webhook route", () => {
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
        id: 7001,
        admin_graphql_api_id: "gid://shopify/Product/7001",
        title: "Updated Tee",
        handle: "updated-tee",
        vendor: "Return Radar",
        product_type: "Apparel",
        status: "active",
        updated_at: "2026-06-16T12:00:00Z",
        variants: [{ id: 1, sku: "TEE-1" }],
        body_html: "<p>secret marketing copy</p>",
      },
      error: null,
    });
    mockPrisma.shopifyProduct.findUnique.mockResolvedValue({
      id: "product-1",
      merchantId: "merchant-1",
      shopifyProductGid: "gid://shopify/Product/7001",
      shopifyProductLegacyId: "7001",
      title: "Blue Tee",
      handle: "blue-tee",
      vendor: "Old Vendor",
      productType: "Shirts",
      status: "draft",
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    });
    mockPrisma.shopifyProduct.update.mockResolvedValue({ id: "product-1" });
  });

  it("returns ignored success when product is not found", async () => {
    mockPrisma.shopifyProduct.findUnique.mockResolvedValue(null);
    mockPrisma.shopifyProduct.findFirst.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/webhooks/products-update", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ignored: true });
    expect(mockPrisma.shopifyProduct.update).not.toHaveBeenCalled();
  });

  it("updates safe product fields for an existing merchant product", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/products-update", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mockPrisma.shopifyProduct.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: {
        title: "Updated Tee",
        handle: "updated-tee",
        vendor: "Return Radar",
        productType: "Apparel",
        status: "active",
        updatedAt: new Date("2026-06-16T12:00:00Z"),
      },
    });
    expect(mockCreateWebhookAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "PRODUCT_UPDATED_WEBHOOK",
        metadata: {
          shopDomain: "demo.myshopify.com",
          shopifyProductId: "7001",
          title: "Updated Tee",
          source: "shopify_webhook",
        },
      }),
    );
  });

  it("returns 401 for invalid HMAC", async () => {
    mockVerifyIncomingShopifyWebhook.mockReturnValue({
      valid: false,
      shopDomain: "demo.myshopify.com",
      error: "Invalid webhook HMAC",
    });

    const response = await POST(
      new Request("http://localhost/api/webhooks/products-update", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });
});
