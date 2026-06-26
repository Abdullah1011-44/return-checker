import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindActiveMerchantsForSync = vi.fn();
const mockQueueShopifySyncForMerchant = vi.fn();
const mockSafeCreateAdminAuditLog = vi.fn();
const mockLogAuditInfo = vi.fn();

vi.mock("@/lib/shopifySyncRunner", () => ({
  findActiveMerchantsForSync: (...args) =>
    mockFindActiveMerchantsForSync(...args),
}));

vi.mock("@/lib/shopifySyncQueue", () => ({
  queueShopifySyncForMerchant: (...args) =>
    mockQueueShopifySyncForMerchant(...args),
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

describe("runShopifySyncScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeCreateAdminAuditLog.mockResolvedValue(null);
    mockFindActiveMerchantsForSync.mockResolvedValue([merchantA, merchantB]);
    mockQueueShopifySyncForMerchant
      .mockResolvedValueOnce({
        queued: true,
        merchantId: "merchant-a",
        reason: "scheduler:manual",
        requestedAt: "2026-06-16T03:00:00.000Z",
      })
      .mockResolvedValueOnce({
        queued: true,
        merchantId: "merchant-b",
        reason: "scheduler:manual",
        requestedAt: "2026-06-16T03:00:01.000Z",
      });
  });

  it("queues sync jobs for active merchants sequentially", async () => {
    const result = await runShopifySyncScheduler();

    expect(result.ok).toBe(true);
    expect(result.trigger).toBe("manual");
    expect(result.merchantCount).toBe(2);
    expect(result.queuedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.results[0]).toMatchObject({
      merchantId: "merchant-a",
      shopDomain: "shop-a.myshopify.com",
      ok: true,
      queued: true,
      reason: "scheduler:manual",
      error: null,
    });

    expect(mockQueueShopifySyncForMerchant).toHaveBeenCalledTimes(2);
    expect(mockQueueShopifySyncForMerchant).toHaveBeenNthCalledWith(1, {
      merchantId: "merchant-a",
      reason: "scheduler:manual",
    });
  });

  it("respects cron trigger and merchantLimit", async () => {
    mockFindActiveMerchantsForSync.mockResolvedValue([merchantA]);
    mockQueueShopifySyncForMerchant.mockReset();
    mockQueueShopifySyncForMerchant.mockResolvedValue({
      queued: true,
      merchantId: "merchant-a",
      reason: "scheduler:cron",
      requestedAt: "2026-06-16T03:00:00.000Z",
    });

    const result = await runShopifySyncScheduler({
      trigger: "cron",
      merchantLimit: 1,
    });

    expect(result.trigger).toBe("cron");
    expect(mockFindActiveMerchantsForSync).toHaveBeenCalledWith(1);
  });

  it("continues when one merchant queue fails", async () => {
    mockQueueShopifySyncForMerchant.mockReset();
    mockQueueShopifySyncForMerchant
      .mockRejectedValueOnce(new Error("Inngest unavailable"))
      .mockResolvedValueOnce({
        queued: true,
        merchantId: "merchant-b",
        reason: "scheduler:manual",
        requestedAt: "2026-06-16T03:00:01.000Z",
      });

    const result = await runShopifySyncScheduler();

    expect(result.queuedCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.results[0]).toMatchObject({
      merchantId: "merchant-a",
      ok: false,
      queued: false,
      error: "Inngest unavailable",
    });
    expect(result.results[1]).toMatchObject({
      merchantId: "merchant-b",
      ok: true,
      queued: true,
    });
  });
});
