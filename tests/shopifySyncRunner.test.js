import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";

const mockSyncShopifyOrdersForMerchant = vi.fn();
const mockSyncShopifyProductsForMerchant = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/syncShopifyOrders", () => ({
  syncShopifyOrdersForMerchant: (...args) =>
    mockSyncShopifyOrdersForMerchant(...args),
  summarizeOrderStatusSyncFromOrders: (orderSyncResult) => ({
    updated: orderSyncResult?.orders?.updated ?? 0,
    skipped: orderSyncResult?.orders?.skipped ?? 0,
  }),
}));

vi.mock("@/lib/shopifyProductSync", () => ({
  syncShopifyProductsForMerchant: (...args) =>
    mockSyncShopifyProductsForMerchant(...args),
}));

import {
  ShopifySyncRunnerError,
  buildSafeMerchantSyncSummary,
  findActiveMerchantsForSync,
  runShopifySyncForMerchant,
} from "@/lib/shopifySyncRunner";

const merchantRecord = {
  id: "merchant-1",
  shopDomain: "demo.myshopify.com",
  shopifyAccessToken: "shpat_test_token",
  isActive: true,
};

describe("shopifySyncRunner", () => {
  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
    mockPrisma.merchant.findUnique.mockResolvedValue(merchantRecord);
    mockSyncShopifyOrdersForMerchant.mockResolvedValue({
      success: true,
      orders: { created: 2, updated: 3, skipped: 1 },
      items: { totalSynced: 10 },
      pagesFetched: 2,
    });
    mockSyncShopifyProductsForMerchant.mockResolvedValue({
      success: true,
      productsSynced: 5,
      variantsSynced: 12,
      pagesSynced: 1,
      warnings: [],
    });
  });

  it("runs only product sync for manual:dashboard-products", async () => {
    const summary = await runShopifySyncForMerchant({
      merchantId: "merchant-1",
      reason: "manual:dashboard-products",
    });

    expect(mockSyncShopifyOrdersForMerchant).not.toHaveBeenCalled();
    expect(mockSyncShopifyProductsForMerchant).toHaveBeenCalledOnce();
    expect(summary.productsSynced).toBe(5);
    expect(summary.ordersSynced).toBe(0);
    expect(summary.orders).toBeNull();
    expect(summary.orderStatuses).toBeNull();
  });

  it("runs only order sync for manual:dashboard-orders", async () => {
    const summary = await runShopifySyncForMerchant({
      merchantId: "merchant-1",
      reason: "manual:dashboard-orders",
    });

    expect(mockSyncShopifyOrdersForMerchant).toHaveBeenCalledOnce();
    expect(mockSyncShopifyProductsForMerchant).not.toHaveBeenCalled();
    expect(summary.ordersSynced).toBe(5);
    expect(summary.productsSynced).toBe(0);
    expect(summary.products).toBeNull();
  });

  it("runs order then product sync and returns safe summary", async () => {
    const summary = await runShopifySyncForMerchant({
      merchantId: "merchant-1",
      reason: "queue:test",
    });

    expect(summary).toEqual({
      success: true,
      merchantId: "merchant-1",
      shopDomain: "demo.myshopify.com",
      reason: "queue:test",
      ordersSynced: 5,
      productsSynced: 5,
      statusUpdated: 3,
      orders: {
        created: 2,
        updated: 3,
        skipped: 1,
        itemsSynced: 10,
        pagesFetched: 2,
      },
      products: {
        productsSynced: 5,
        variantsSynced: 12,
        pagesSynced: 1,
        warningCount: 0,
      },
      orderStatuses: { updated: 3, skipped: 1 },
    });

    expect(mockSyncShopifyOrdersForMerchant).toHaveBeenCalledBefore(
      mockSyncShopifyProductsForMerchant
    );
    expect(mockSyncShopifyProductsForMerchant).toHaveBeenCalledWith({
      id: "merchant-1",
      shopDomain: "demo.myshopify.com",
      accessToken: "shpat_test_token",
    });

    const summaryText = JSON.stringify(summary);
    expect(summaryText).not.toContain("shpat_test_token");
    expect(summaryText).not.toContain("customerEmail");
  });

  it("throws sanitized error when merchant is inactive", async () => {
    mockPrisma.merchant.findUnique.mockResolvedValue({
      ...merchantRecord,
      isActive: false,
    });

    await expect(
      runShopifySyncForMerchant({ merchantId: "merchant-1" })
    ).rejects.toMatchObject({
      name: "ShopifySyncRunnerError",
      code: "MERCHANT_INACTIVE",
      retryable: false,
    });

    expect(mockSyncShopifyOrdersForMerchant).not.toHaveBeenCalled();
  });

  it("throws sanitized retryable error when sync fails", async () => {
    mockSyncShopifyOrdersForMerchant.mockRejectedValue(
      Object.assign(new Error("Shopify rate limit"), {
        code: "SHOPIFY_RATE_LIMIT",
      })
    );

    await expect(
      runShopifySyncForMerchant({ merchantId: "merchant-1", reason: "queue" })
    ).rejects.toBeInstanceOf(ShopifySyncRunnerError);

    expect(mockSyncShopifyProductsForMerchant).not.toHaveBeenCalled();
  });

  it("findActiveMerchantsForSync filters blank shop domains and omits tokens", async () => {
    mockPrisma.merchant.findMany.mockResolvedValue([
      {
        id: "merchant-empty",
        shopDomain: "  ",
      },
      {
        id: "merchant-1",
        shopDomain: "demo.myshopify.com",
      },
    ]);

    const merchants = await findActiveMerchantsForSync(10);

    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toEqual({
      id: "merchant-1",
      shopDomain: "demo.myshopify.com",
    });
    expect(merchants[0]).not.toHaveProperty("shopifyAccessToken");
    expect(mockPrisma.merchant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, shopDomain: true },
      })
    );
  });

  it("buildSafeMerchantSyncSummary never includes access tokens", () => {
    const summary = buildSafeMerchantSyncSummary({
      merchant: merchantRecord,
      orderSyncResult: {
        orders: { created: 1, updated: 0, skipped: 0 },
        items: { totalSynced: 1 },
        pagesFetched: 1,
      },
      productSyncResult: {
        productsSynced: 2,
        variantsSynced: 4,
        pagesSynced: 1,
        warnings: [],
      },
      reason: "test",
    });

    expect(JSON.stringify(summary)).not.toContain("shpat_test_token");
    expect(summary.ordersSynced).toBe(1);
    expect(summary.productsSynced).toBe(2);
    expect(summary.statusUpdated).toBe(0);
  });

  it("buildSafeMerchantSyncSummary handles null order or product results", () => {
    const productsOnly = buildSafeMerchantSyncSummary({
      merchant: merchantRecord,
      orderSyncResult: null,
      productSyncResult: {
        productsSynced: 3,
        variantsSynced: 6,
        pagesSynced: 1,
        warnings: [],
      },
      reason: "manual:dashboard-products",
    });

    expect(productsOnly.orders).toBeNull();
    expect(productsOnly.orderStatuses).toBeNull();
    expect(productsOnly.ordersSynced).toBe(0);
    expect(productsOnly.productsSynced).toBe(3);

    const ordersOnly = buildSafeMerchantSyncSummary({
      merchant: merchantRecord,
      orderSyncResult: {
        orders: { created: 1, updated: 2, skipped: 0 },
        items: { totalSynced: 3 },
        pagesFetched: 1,
      },
      productSyncResult: null,
      reason: "manual:dashboard-orders",
    });

    expect(ordersOnly.products).toBeNull();
    expect(ordersOnly.productsSynced).toBe(0);
    expect(ordersOnly.ordersSynced).toBe(3);
  });
});
