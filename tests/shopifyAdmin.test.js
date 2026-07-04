import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  optionalEnv: (_key, fallback) => fallback,
}));

import {
  buildShopifyAdminHttpError,
  buildShopifyAdminRestUrl,
  mapShopifyAdminHttpErrorCode,
  sanitizeShopifyErrorText,
  shopifyAdminRequest,
  summarizeShopifyErrorBody,
  validateShopifyAdminShopDomain,
  validateShopifyBaseUrlOverride,
} from "@/lib/shopifyAdmin";

describe("shopifyAdmin error classification", () => {
  it("maps HTTP status codes to specific Shopify error codes", () => {
    expect(mapShopifyAdminHttpErrorCode(401)).toBe("SHOPIFY_TOKEN_INVALID");
    expect(mapShopifyAdminHttpErrorCode(403)).toBe(
      "SHOPIFY_ORDER_ACCESS_DENIED",
    );
    expect(mapShopifyAdminHttpErrorCode(404)).toBe(
      "SHOPIFY_ENDPOINT_NOT_FOUND",
    );
    expect(mapShopifyAdminHttpErrorCode(429)).toBe("SHOPIFY_RATE_LIMITED");
    expect(mapShopifyAdminHttpErrorCode(500)).toBe("SHOPIFY_API_ERROR");
  });

  it("maps 403 protected customer data to dedicated code", () => {
    expect(
      mapShopifyAdminHttpErrorCode(
        403,
        "This app is not approved to access protected customer data",
      ),
    ).toBe("SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED");
  });

  it("builds HTTP errors with endpoint and API version metadata", () => {
    const error = buildShopifyAdminHttpError({
      status: 404,
      endpoint: "/orders.json",
      bodyText: '{"errors":"Not Found"}',
      shopDomain: "demo.myshopify.com",
    });

    expect(error.code).toBe("SHOPIFY_ENDPOINT_NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.endpoint).toBe("/orders.json");
    expect(error.apiType).toBe("REST");
    expect(error.apiVersion).toBe("2026-04");
    expect(error.shopDomain).toBe("demo.myshopify.com");
  });

  it("sanitizes tokens and emails from error summaries", () => {
    const summary = summarizeShopifyErrorBody(
      '{"errors":"Invalid token shpat_abc123 for user@test.com"}',
      { errors: "Invalid token shpat_abc123 for user@test.com" },
    );

    expect(summary).not.toContain("shpat_abc123");
    expect(summary).not.toContain("user@test.com");
    expect(summary).toContain("[REDACTED]");
    expect(summary).toContain("[REDACTED_EMAIL]");
  });

  it("sanitizes bearer tokens in free text", () => {
    expect(sanitizeShopifyErrorText("Bearer shpat_secret123")).toBe(
      "Bearer [REDACTED]",
    );
  });

  it("builds Admin REST URLs from merchant shop domains", () => {
    expect(
      buildShopifyAdminRestUrl("return-ai-saas.myshopify.com", "/orders.json"),
    ).toBe(
      "https://return-ai-saas.myshopify.com/admin/api/2026-04/orders.json",
    );
  });

  it("rejects localhost shop domains outside test", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    expect(() => validateShopifyAdminShopDomain("localhost")).toThrow(
      /localhost/i,
    );

    process.env.NODE_ENV = previousNodeEnv;
  });

  it("rejects localhost Shopify base URL overrides outside test", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    expect(() =>
      validateShopifyBaseUrlOverride("http://localhost:8288"),
    ).toThrow(/localhost/i);

    process.env.NODE_ENV = previousNodeEnv;
  });
});

describe("shopifyAdminRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws SHOPIFY_TOKEN_INVALID on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"errors":"Invalid API key or access token"}',
        headers: { get: () => null },
      }),
    );

    await expect(
      shopifyAdminRequest("demo.myshopify.com", "shpat_test", "/shop.json"),
    ).rejects.toMatchObject({
      code: "SHOPIFY_TOKEN_INVALID",
      status: 401,
      endpoint: "/shop.json",
      apiVersion: "2026-04",
    });
  });

  it("throws SHOPIFY_ORDER_ACCESS_DENIED on 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => '{"errors":"Access denied for orders scope"}',
        headers: { get: () => null },
      }),
    );

    await expect(
      shopifyAdminRequest("demo.myshopify.com", "shpat_test", "/orders.json"),
    ).rejects.toMatchObject({
      code: "SHOPIFY_ORDER_ACCESS_DENIED",
      status: 403,
      endpoint: "/orders.json",
    });
  });

  it("throws SHOPIFY_ENDPOINT_NOT_FOUND on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => '{"errors":"Not Found"}',
        headers: { get: () => null },
      }),
    );

    await expect(
      shopifyAdminRequest("demo.myshopify.com", "shpat_test", "/orders.json"),
    ).rejects.toMatchObject({
      code: "SHOPIFY_ENDPOINT_NOT_FOUND",
      status: 404,
    });
  });

  it("throws SHOPIFY_NETWORK_ERROR when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    await expect(
      shopifyAdminRequest("demo.myshopify.com", "shpat_test", "/shop.json"),
    ).rejects.toMatchObject({
      code: "SHOPIFY_NETWORK_ERROR",
      endpoint: "/shop.json",
    });
  });
});
