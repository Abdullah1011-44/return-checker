import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInngestSend = vi.fn();

vi.mock("@/lib/inngest", () => ({
  inngest: {
    send: (...args) => mockInngestSend(...args),
  },
}));

import {
  SHOPIFY_SYNC_REQUESTED_EVENT,
  buildShopifySyncEventData,
  queueShopifySyncForMerchant,
} from "@/lib/shopifySyncQueue";

describe("shopifySyncQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInngestSend.mockResolvedValue({ ids: ["evt_1"] });
  });

  it("builds safe event payload", () => {
    const data = buildShopifySyncEventData({
      merchantId: "merchant-1",
      reason: "scheduler:cron",
    });

    expect(data).toEqual({
      merchantId: "merchant-1",
      reason: "scheduler:cron",
      requestedAt: expect.any(String),
    });
    expect(JSON.stringify(data)).not.toContain("accessToken");
  });

  it("queues shopify/sync.requested via Inngest", async () => {
    const result = await queueShopifySyncForMerchant({
      merchantId: "merchant-1",
      reason: "manual:dashboard-orders",
    });

    expect(mockInngestSend).toHaveBeenCalledWith({
      name: SHOPIFY_SYNC_REQUESTED_EVENT,
      data: {
        merchantId: "merchant-1",
        reason: "manual:dashboard-orders",
        requestedAt: result.requestedAt,
      },
    });
    expect(result).toMatchObject({
      queued: true,
      merchantId: "merchant-1",
      reason: "manual:dashboard-orders",
    });
  });
});
