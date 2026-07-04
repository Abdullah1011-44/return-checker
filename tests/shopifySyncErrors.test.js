import { describe, expect, it } from "vitest";
import {
  buildShopifySyncErrorDetails,
  buildShopifySyncErrorMessage,
  isInngestQueueError,
  isShopifyNetworkError,
  resolveSyncFailureAudit,
} from "@/lib/shopifySyncErrors";

describe("shopifySyncErrors", () => {
  it("preserves specific Shopify error codes instead of generic connection errors", () => {
    expect(
      resolveSyncFailureAudit({
        code: "SHOPIFY_TOKEN_INVALID",
        status: 401,
      }),
    ).toEqual({ code: "SHOPIFY_TOKEN_INVALID", httpStatus: 401 });

    expect(
      resolveSyncFailureAudit({
        code: "SHOPIFY_ORDER_ACCESS_DENIED",
        status: 403,
      }),
    ).toEqual({ code: "SHOPIFY_ORDER_ACCESS_DENIED", httpStatus: 403 });

    expect(
      resolveSyncFailureAudit({
        code: "SHOPIFY_ENDPOINT_NOT_FOUND",
        status: 404,
        endpoint: "/orders.json",
        apiVersion: "2026-04",
      }),
    ).toEqual({ code: "SHOPIFY_ENDPOINT_NOT_FOUND", httpStatus: 404 });

    expect(
      resolveSyncFailureAudit({
        code: "SHOPIFY_RATE_LIMITED",
        status: 429,
      }),
    ).toEqual({ code: "SHOPIFY_RATE_LIMITED", httpStatus: 429 });

    expect(
      resolveSyncFailureAudit({
        code: "SHOPIFY_NETWORK_ERROR",
      }),
    ).toEqual({ code: "SHOPIFY_NETWORK_ERROR", httpStatus: 503 });
  });

  it("maps legacy SHOPIFY_RATE_LIMIT to SHOPIFY_RATE_LIMITED", () => {
    expect(
      resolveSyncFailureAudit({
        code: "SHOPIFY_RATE_LIMIT",
        status: 429,
      }),
    ).toEqual({ code: "SHOPIFY_RATE_LIMITED", httpStatus: 429 });
  });

  it("maps fetch failures to SHOPIFY_NETWORK_ERROR", () => {
    expect(
      resolveSyncFailureAudit(
        Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ECONNREFUSED" },
        }),
      ),
    ).toEqual({ code: "SHOPIFY_NETWORK_ERROR", httpStatus: 503 });
  });

  it("returns reconnect guidance for invalid tokens", () => {
    expect(
      buildShopifySyncErrorMessage({ code: "SHOPIFY_TOKEN_INVALID" }),
    ).toContain("Reconnect");
  });

  it("includes endpoint detail for 404 responses", () => {
    expect(
      buildShopifySyncErrorMessage({
        code: "SHOPIFY_ENDPOINT_NOT_FOUND",
        endpoint: "/orders.json",
        apiVersion: "2026-04",
      }),
    ).toContain("REST 2026-04/orders.json");
  });

  it("includes reconnect path for invalid Shopify tokens", () => {
    expect(
      buildShopifySyncErrorDetails(
        { code: "SHOPIFY_TOKEN_INVALID" },
        { shopDomain: "return-ai-saas.myshopify.com" },
      ),
    ).toEqual({
      nextStep:
        "Reconnect the app from Shopify Admin to refresh the access token.",
      reconnectPath: "/api/auth/install?shop=return-ai-saas.myshopify.com",
    });
  });

  it("does not classify Inngest localhost:8288 failures as Shopify network errors", () => {
    const inngestError = Object.assign(new TypeError("fetch failed"), {
      code: "INNGEST_QUEUE_UNAVAILABLE",
      cause: { code: "ECONNREFUSED", port: 8288 },
    });

    expect(isInngestQueueError(inngestError)).toBe(true);
    expect(isShopifyNetworkError(inngestError)).toBe(false);
    expect(resolveSyncFailureAudit(inngestError)).toEqual({
      code: "INNGEST_QUEUE_UNAVAILABLE",
      httpStatus: 503,
    });
    expect(buildShopifySyncErrorMessage(inngestError)).toContain("Inngest");
  });
});
