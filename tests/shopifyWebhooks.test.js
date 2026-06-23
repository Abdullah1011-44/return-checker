import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockShopifyAdminRequest = vi.fn();

vi.mock("@/lib/shopifyAdmin", () => ({
  shopifyAdminRequest: (...args) => mockShopifyAdminRequest(...args),
}));

import {
  buildWebhookAddress,
  normalizeAppUrl,
  registerShopifyWebhooks,
  webhookAlreadyExists,
} from "@/lib/shopifyWebhooks";

describe("shopifyWebhooks", () => {
  const originalAppUrl = process.env.APP_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://app.returnradar.example";
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.APP_URL = originalAppUrl;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("normalizes APP_URL trailing slashes", () => {
    expect(normalizeAppUrl("https://app.example.com/")).toBe(
      "https://app.example.com"
    );
    expect(buildWebhookAddress("https://app.example.com", "/api/webhooks/orders-create")).toBe(
      "https://app.example.com/api/webhooks/orders-create"
    );
  });

  it("returns failed result when APP_URL is missing", async () => {
    delete process.env.APP_URL;

    const result = await registerShopifyWebhooks({
      shopDomain: "demo.myshopify.com",
      accessToken: "token",
    });

    expect(result.success).toBe(false);
    expect(result.failed).toEqual([{ reason: "Missing APP_URL" }]);
    expect(mockShopifyAdminRequest).not.toHaveBeenCalled();
  });

  it("blocks localhost APP_URL outside development", async () => {
    process.env.APP_URL = "http://localhost:3000";
    process.env.NODE_ENV = "production";

    const result = await registerShopifyWebhooks({
      shopDomain: "demo.myshopify.com",
      accessToken: "token",
    });

    expect(result.success).toBe(false);
    expect(result.failed[0]?.reason).toBe(
      "APP_URL points to localhost outside development"
    );
    expect(mockShopifyAdminRequest).not.toHaveBeenCalled();
  });

  it("skips webhooks that already exist for the same topic and address", async () => {
    mockShopifyAdminRequest.mockResolvedValueOnce({
      data: {
        webhooks: [
          {
            topic: "orders/create",
            address:
              "https://app.returnradar.example/api/webhooks/orders-create",
          },
        ],
      },
    });

    const result = await registerShopifyWebhooks({
      shopDomain: "demo.myshopify.com",
      accessToken: "token",
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      topic: "orders/create",
      endpointPath: "/api/webhooks/orders-create",
      reason: "Webhook already registered",
    });
    expect(result.registered).toHaveLength(3);
    expect(mockShopifyAdminRequest).toHaveBeenCalledTimes(4);
  });

  it("detects duplicate webhooks by topic and address", () => {
    expect(
      webhookAlreadyExists(
        [
          {
            topic: "orders/updated",
            address: "https://app.example.com/api/webhooks/orders-updated",
          },
        ],
        "orders/updated",
        "https://app.example.com/api/webhooks/orders-updated"
      )
    ).toBe(true);

    expect(
      webhookAlreadyExists(
        [{ topic: "orders/updated", address: "https://other.example.com/hook" }],
        "orders/updated",
        "https://app.example.com/api/webhooks/orders-updated"
      )
    ).toBe(false);
  });

  it("continues registering other webhooks when one create call fails", async () => {
    mockShopifyAdminRequest
      .mockResolvedValueOnce({ data: { webhooks: [] } })
      .mockRejectedValueOnce({ status: 403 })
      .mockResolvedValue({ data: { webhook: { id: 1 } } });

    const result = await registerShopifyWebhooks({
      shopDomain: "demo.myshopify.com",
      accessToken: "token",
    });

    expect(result.success).toBe(false);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.topic).toBe("orders/create");
    expect(result.registered).toHaveLength(3);
  });
});
