import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInngestSend = vi.fn();

vi.mock("@/lib/inngest", () => ({
  inngest: {
    send: (...args) => mockInngestSend(...args),
  },
}));

import {
  buildShopifySyncEventData,
  classifyInngestQueueError,
  queueShopifySyncForMerchant,
  SHOPIFY_SYNC_REQUESTED_EVENT,
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

  it("classifies localhost:8288 Inngest dev server failures separately", () => {
    const error = classifyInngestQueueError(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED", port: 8288 },
      }),
    );

    expect(error).toMatchObject({
      code: "INNGEST_QUEUE_UNAVAILABLE",
      status: 503,
    });
    expect(error.message).toContain("8288");
  });

  it("throws INNGEST_QUEUE_UNAVAILABLE when Inngest send fails locally", async () => {
    mockInngestSend.mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED", port: 8288 },
      }),
    );

    await expect(
      queueShopifySyncForMerchant({
        merchantId: "merchant-1",
        reason: "scheduler:cron",
      }),
    ).rejects.toMatchObject({
      code: "INNGEST_QUEUE_UNAVAILABLE",
      status: 503,
    });
  });
});
