import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";

const mockSyncShopifyOrdersForMerchant = vi.fn();
const mockSyncShopifyProductsForMerchant = vi.fn();
const mockSafeCreateAdminAuditLog = vi.fn();
const mockLogAuditInfo = vi.fn();

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

vi.mock("@/lib/adminAudit", () => ({
  ADMIN_AUDIT_ACTORS: { SYSTEM: "SYSTEM" },
  ADMIN_AUDIT_EVENTS: {
    SHOPIFY_SYNC_SCHEDULER_STARTED: "SHOPIFY_SYNC_SCHEDULER_STARTED",
    SHOPIFY_SYNC_SCHEDULER_MERCHANT_SUCCESS:
      "SHOPIFY_SYNC_SCHEDULER_MERCHANT_SUCCESS",
    SHOPIFY_SYNC_SCHEDULER_MERCHANT_FAILED:
      "SHOPIFY_SYNC_SCHEDULER_MERCHANT_FAILED",
    SHOPIFY_SYNC_SCHEDULER_FINISHED: "SHOPIFY_SYNC_SCHEDULER_FINISHED",
  },
  ADMIN_AUDIT_SEVERITY: { INFO: "INFO", ERROR: "ERROR" },
  safeCreateAdminAuditLog: (...args) => mockSafeCreateAdminAuditLog(...args),
}));

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTORS: { SYSTEM: "SYSTEM" },
  AUDIT_EVENTS: {
    SHOPIFY_SYNC_SCHEDULER_STARTED: "SHOPIFY_SYNC_SCHEDULER_STARTED",
    SHOPIFY_SYNC_SCHEDULER_MERCHANT_SUCCESS:
      "SHOPIFY_SYNC_SCHEDULER_MERCHANT_SUCCESS",
    SHOPIFY_SYNC_SCHEDULER_MERCHANT_FAILED:
      "SHOPIFY_SYNC_SCHEDULER_MERCHANT_FAILED",
    SHOPIFY_SYNC_SCHEDULER_FINISHED: "SHOPIFY_SYNC_SCHEDULER_FINISHED",
  },
  logAuditInfo: (...args) => mockLogAuditInfo(...args),
  sanitizeAuditMetadata: (metadata) => metadata,
}));

import { runShopifySyncScheduler } from "@/lib/syncScheduler";

const merchantA = {
  id: "merchant-a",
  shopDomain: "shop-a.myshopify.com",
  shopifyAccessToken: "token-a",
};

const merchantB = {
  id: "merchant-b",
  shopDomain: "shop-b.myshopify.com",
  shopifyAccessToken: "token-b",
};

describe("runShopifySyncScheduler", () => {
  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
    mockSafeCreateAdminAuditLog.mockResolvedValue(null);
    mockPrisma.merchant.findMany.mockResolvedValue([merchantA, merchantB]);
    mockSyncShopifyOrdersForMerchant.mockResolvedValue({
      success: true,
      orders: { created: 1, updated: 2, skipped: 0 },
      items: { totalSynced: 3 },
      pagesFetched: 1,
    });
    mockSyncShopifyProductsForMerchant.mockResolvedValue({
      success: true,
      productsSynced: 4,
      variantsSynced: 8,
      pagesSynced: 1,
      warnings: [],
    });
  });

  it("syncs active merchants sequentially with default options", async () => {
    const result = await runShopifySyncScheduler();

    expect(result.ok).toBe(true);
    expect(result.trigger).toBe("manual");
    expect(result.merchantCount).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      merchantId: "merchant-a",
      shopDomain: "shop-a.myshopify.com",
      ok: true,
      orders: {
        created: 1,
        updated: 2,
        skipped: 0,
        itemsSynced: 3,
        pagesFetched: 1,
      },
      products: {
        productsSynced: 4,
        variantsSynced: 8,
        pagesSynced: 1,
        warningCount: 0,
      },
      orderStatuses: { updated: 2, skipped: 0 },
      error: null,
    });

    expect(mockSyncShopifyOrdersForMerchant).toHaveBeenCalledTimes(2);
    expect(mockSyncShopifyProductsForMerchant).toHaveBeenCalledTimes(2);
    expect(mockSyncShopifyOrdersForMerchant.mock.invocationCallOrder[0]).toBeLessThan(
      mockSyncShopifyProductsForMerchant.mock.invocationCallOrder[0]
    );
    expect(mockSyncShopifyOrdersForMerchant.mock.invocationCallOrder[1]).toBeLessThan(
      mockSyncShopifyProductsForMerchant.mock.invocationCallOrder[1]
    );
  });

  it("respects cron trigger and merchantLimit", async () => {
    mockPrisma.merchant.findMany.mockResolvedValue([merchantA]);

    const result = await runShopifySyncScheduler({
      trigger: "cron",
      merchantLimit: 1,
    });

    expect(result.trigger).toBe("cron");
    expect(mockPrisma.merchant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1 })
    );
  });

  it("continues when one merchant fails", async () => {
    mockSyncShopifyOrdersForMerchant
      .mockRejectedValueOnce(new Error("Shopify unavailable"))
      .mockResolvedValueOnce({
        success: true,
        orders: { created: 0, updated: 1, skipped: 0 },
        items: { totalSynced: 1 },
        pagesFetched: 1,
      });

    const result = await runShopifySyncScheduler();

    expect(result.merchantCount).toBe(2);
    expect(result.results[0]).toMatchObject({
      merchantId: "merchant-a",
      ok: false,
      error: "Shopify unavailable",
      orders: null,
      products: null,
      orderStatuses: null,
    });
    expect(result.results[1]).toMatchObject({
      merchantId: "merchant-b",
      ok: true,
    });
    expect(mockSyncShopifyProductsForMerchant).toHaveBeenCalledTimes(1);
  });

  it("records scheduler audit events", async () => {
    mockSyncShopifyOrdersForMerchant
      .mockRejectedValueOnce(new Error("Shopify unavailable"))
      .mockResolvedValueOnce({
        success: true,
        orders: { created: 0, updated: 1, skipped: 0 },
        items: { totalSynced: 1 },
        pagesFetched: 1,
      });

    await runShopifySyncScheduler({ trigger: "cron", merchantLimit: 2 });

    expect(mockSafeCreateAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SHOPIFY_SYNC_SCHEDULER_STARTED",
      })
    );
    expect(mockSafeCreateAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SHOPIFY_SYNC_SCHEDULER_MERCHANT_SUCCESS",
        merchantId: "merchant-b",
      })
    );
    expect(mockSafeCreateAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SHOPIFY_SYNC_SCHEDULER_MERCHANT_FAILED",
        merchantId: "merchant-a",
      })
    );
    expect(mockSafeCreateAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "SHOPIFY_SYNC_SCHEDULER_FINISHED",
      })
    );
  });

  it("filters merchants missing shop domain or token", async () => {
    mockPrisma.merchant.findMany.mockResolvedValue([
      {
        id: "merchant-empty",
        shopDomain: "  ",
        shopifyAccessToken: "token",
      },
      merchantA,
    ]);

    const result = await runShopifySyncScheduler();

    expect(result.merchantCount).toBe(1);
    expect(result.results[0].merchantId).toBe("merchant-a");
  });
});
