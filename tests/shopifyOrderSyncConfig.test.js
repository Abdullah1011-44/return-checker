import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  optionalEnv: (key, fallback) => {
    if (key === "SHOPIFY_APP_URL" || key === "APP_URL") {
      return "https://app.example.com";
    }
    return fallback;
  },
  requireEnv: (key) => `test-${key}`,
}));

import { getShopifyConfig } from "@/lib/shopify";
import { buildAuthorizeUrl } from "@/lib/shopifyOAuth";
import { getShopifyOrderSyncRequestInfo } from "@/lib/syncShopifyOrders";

describe("Shopify OAuth and order sync configuration", () => {
  it("defaults OAuth scopes to read_orders", () => {
    const config = getShopifyConfig();

    expect(config.scopes).toContain("read_orders");
    expect(config.scopesString).toBe("read_orders");
  });

  it("requests read_orders in the OAuth authorize URL", () => {
    const url = buildAuthorizeUrl({
      shop: "demo.myshopify.com",
      state: "state-123",
      apiKey: "test-key",
      scopes: "read_orders",
      redirectUri: "https://app.example.com/api/auth/callback",
    });

    expect(url).toContain("scope=read_orders");
  });

  it("documents REST order sync endpoints and required scope", () => {
    const info = getShopifyOrderSyncRequestInfo();

    expect(info).toEqual({
      apiType: "REST",
      apiVersion: "2026-04",
      connectionTestEndpoint: "/shop.json",
      ordersEndpoint: "/orders.json",
      ordersQuery: expect.stringContaining("status=any"),
      initialOrdersPath: expect.stringContaining("/orders.json"),
      orderFields: expect.stringContaining("line_items"),
      requiredScope: "read_orders",
    });
    expect(info.orderFields).not.toContain("email");
    expect(info.orderFields).not.toContain("phone");
  });
});
