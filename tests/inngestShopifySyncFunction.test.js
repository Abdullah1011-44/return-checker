import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";

const mockRunShopifySyncForMerchant = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/shopifySyncRunner", () => ({
  runShopifySyncForMerchant: (...args) =>
    mockRunShopifySyncForMerchant(...args),
  ShopifySyncRunnerError: class ShopifySyncRunnerError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = "ShopifySyncRunnerError";
      this.code = options.code ?? "SHOPIFY_SYNC_RUNNER_ERROR";
      this.retryable = options.retryable ?? true;
    }
  },
}));

import { syncShopifyData } from "@/lib/inngestFunctions/shopifySync";

describe("syncShopifyData inngest function", () => {
  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
    mockPrisma.merchant.findUnique.mockResolvedValue({ id: "merchant-1" });
    mockRunShopifySyncForMerchant.mockResolvedValue({
      success: true,
      merchantId: "merchant-1",
      shopDomain: "demo.myshopify.com",
      ordersSynced: 2,
      productsSynced: 3,
      statusUpdated: 1,
    });
  });

  it("is configured with retries and event trigger", () => {
    expect(syncShopifyData.id("")).toBe("sync-shopify-data");
    expect(syncShopifyData.opts.retries).toBe(3);
    expect(syncShopifyData.opts.triggers).toEqual([
      { event: "shopify/sync.requested" },
    ]);
  });

  it("runs sync runner with merchantId from event", async () => {
    const handler = syncShopifyData["fn"];
    const summary = await handler({
      event: {
        data: {
          merchantId: "merchant-1",
          reason: "scheduler:cron",
          requestedAt: "2026-06-16T03:00:00.000Z",
        },
      },
    });

    expect(mockRunShopifySyncForMerchant).toHaveBeenCalledWith({
      merchantId: "merchant-1",
      reason: "scheduler:cron",
    });
    expect(summary.ordersSynced).toBe(2);
  });
});
