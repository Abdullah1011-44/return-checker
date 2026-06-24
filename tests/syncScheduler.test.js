import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindActiveMerchantsForSync = vi.fn();
const mockRunShopifySyncForMerchant = vi.fn();
const mockSafeCreateAdminAuditLog = vi.fn();
const mockLogAuditInfo = vi.fn();

vi.mock("@/lib/shopifySyncRunner", () => ({
  findActiveMerchantsForSync: (...args) => mockFindActiveMerchantsForSync(...args),
  runShopifySyncForMerchant: (...args) => mockRunShopifySyncForMerchant(...args),
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
};

const merchantB = {
  id: "merchant-b",
  shopDomain: "shop-b.myshopify.com",
};

function buildSummary(merchant, overrides = {}) {
  return {
    success: true,
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    reason: "scheduler:manual",
    ordersSynced: 3,
    productsSynced: 4,
    statusUpdated: 2,
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
    ...overrides,
  };
}

describe("runShopifySyncScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeCreateAdminAuditLog.mockResolvedValue(null);
    mockFindActiveMerchantsForSync.mockResolvedValue([merchantA, merchantB]);
    mockRunShopifySyncForMerchant
      .mockResolvedValueOnce(buildSummary(merchantA))
      .mockResolvedValueOnce(buildSummary(merchantB));
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

    expect(mockRunShopifySyncForMerchant).toHaveBeenCalledTimes(2);
    expect(mockRunShopifySyncForMerchant).toHaveBeenNthCalledWith(1, {
      merchantId: "merchant-a",
      reason: "scheduler:manual",
    });
    expect(mockRunShopifySyncForMerchant).toHaveBeenNthCalledWith(2, {
      merchantId: "merchant-b",
      reason: "scheduler:manual",
    });
  });

  it("respects cron trigger and merchantLimit", async () => {
    mockFindActiveMerchantsForSync.mockResolvedValue([merchantA]);
    mockRunShopifySyncForMerchant.mockReset();
    mockRunShopifySyncForMerchant.mockResolvedValue(
      buildSummary(merchantA, { reason: "scheduler:cron" })
    );

    const result = await runShopifySyncScheduler({
      trigger: "cron",
      merchantLimit: 1,
    });

    expect(result.trigger).toBe("cron");
    expect(mockFindActiveMerchantsForSync).toHaveBeenCalledWith(1);
    expect(mockRunShopifySyncForMerchant).toHaveBeenCalledWith({
      merchantId: "merchant-a",
      reason: "scheduler:cron",
    });
  });

  it("continues when one merchant fails", async () => {
    mockRunShopifySyncForMerchant.mockReset();
    mockRunShopifySyncForMerchant
      .mockRejectedValueOnce(new Error("Shopify unavailable"))
      .mockResolvedValueOnce(
        buildSummary(merchantB, {
          ordersSynced: 1,
          orders: {
            created: 0,
            updated: 1,
            skipped: 0,
            itemsSynced: 1,
            pagesFetched: 1,
          },
          orderStatuses: { updated: 1, skipped: 0 },
        })
      );

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
  });

  it("records scheduler audit events", async () => {
    mockRunShopifySyncForMerchant.mockReset();
    mockRunShopifySyncForMerchant
      .mockRejectedValueOnce(new Error("Shopify unavailable"))
      .mockResolvedValueOnce(buildSummary(merchantB, { reason: "scheduler:cron" }));

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
});
