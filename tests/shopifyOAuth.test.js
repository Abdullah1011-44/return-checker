import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  optionalEnv: (key, fallback) => {
    if (key === "SHOPIFY_APP_URL" || key === "APP_URL") {
      return "https://walk-undertook-professed.ngrok-free.dev";
    }
    if (key === "SHOPIFY_SCOPES") {
      return "read_orders,read_products";
    }
    return fallback;
  },
  requireEnv: (key) => {
    if (key === "SHOPIFY_API_KEY") {
      return "64b0502aafeb70588c4ba6cb34c8506c";
    }
    if (key === "SHOPIFY_API_SECRET") {
      return "shpss_test_secret_value";
    }
    return `test-${key}`;
  },
  isDevelopment: () => true,
}));

import {
  buildShopifyInstallUrl,
  exchangeAuthorizationCode,
  getOAuthRedirectUri,
  getShopifyCredentialFingerprint,
  upsertMerchantFromOAuth,
} from "@/lib/shopifyOAuth";

describe("shopifyOAuth token persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exchanges authorization code with redirect_uri and current app credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "shpat_new_valid_token_1234567890",
        scope: "read_orders,read_products",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeAuthorizationCode(
      "return-ai-saas.myshopify.com",
      "oauth-code-123",
    );

    expect(result.accessToken).toBe("shpat_new_valid_token_1234567890");
    expect(result.scope).toBe("read_orders,read_products");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://return-ai-saas.myshopify.com/admin/oauth/access_token",
    );

    const body = JSON.parse(options.body);
    expect(body.client_id).toBe("64b0502aafeb70588c4ba6cb34c8506c");
    expect(body.client_secret).toBe("shpss_test_secret_value");
    expect(body.code).toBe("oauth-code-123");
    expect(body.redirect_uri).toBe(
      "https://walk-undertook-professed.ngrok-free.dev/api/auth/callback",
    );
  });

  it("replaces an existing merchant token on reinstall", async () => {
    const existingMerchant = {
      id: "merchant-1",
      shopDomain: "Return-AI-SaaS.myshopify.com",
      shopifyAccessToken: "shpat_old_revoked_token",
    };

    const mockPrisma = {
      merchant: {
        findFirst: vi.fn().mockResolvedValue(existingMerchant),
        update: vi.fn().mockResolvedValue({
          id: "merchant-1",
          shopDomain: "return-ai-saas.myshopify.com",
          shopifyAccessToken: "shpat_new_valid_token_1234567890",
        }),
        create: vi.fn(),
      },
    };

    const merchant = await upsertMerchantFromOAuth(
      mockPrisma,
      "return-ai-saas.myshopify.com",
      "shpat_new_valid_token_1234567890",
      "read_orders,read_products",
    );

    expect(mockPrisma.merchant.findFirst).toHaveBeenCalledWith({
      where: {
        shopDomain: {
          equals: "return-ai-saas.myshopify.com",
          mode: "insensitive",
        },
      },
      select: {
        id: true,
        shopDomain: true,
        shopifyAccessToken: true,
      },
    });

    expect(mockPrisma.merchant.update).toHaveBeenCalledWith({
      where: { id: "merchant-1" },
      data: expect.objectContaining({
        shopDomain: "return-ai-saas.myshopify.com",
        shopifyAccessToken: "shpat_new_valid_token_1234567890",
        isActive: true,
        shopifyUninstalledAt: null,
        shopifyScope: "read_orders,read_products",
      }),
    });
    expect(mockPrisma.merchant.create).not.toHaveBeenCalled();
    expect(merchant.shopifyAccessToken).toBe(
      "shpat_new_valid_token_1234567890",
    );
  });

  it("creates a merchant when OAuth installs a new shop", async () => {
    const mockPrisma = {
      merchant: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: "merchant-new",
          shopDomain: "return-ai-saas.myshopify.com",
          shopifyAccessToken: "shpat_new_valid_token_1234567890",
        }),
      },
    };

    await upsertMerchantFromOAuth(
      mockPrisma,
      "return-ai-saas.myshopify.com",
      "shpat_new_valid_token_1234567890",
      "read_orders,read_products",
    );

    expect(mockPrisma.merchant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopDomain: "return-ai-saas.myshopify.com",
        shopifyAccessToken: "shpat_new_valid_token_1234567890",
        email: "auth+return-ai-saas.myshopify.com@shopify.install",
      }),
    });
  });

  it("builds install and callback URLs from current app env", () => {
    expect(
      getOAuthRedirectUri("https://walk-undertook-professed.ngrok-free.dev"),
    ).toBe("https://walk-undertook-professed.ngrok-free.dev/api/auth/callback");

    expect(buildShopifyInstallUrl("return-ai-saas.myshopify.com")).toBe(
      "https://walk-undertook-professed.ngrok-free.dev/api/auth/install?shop=return-ai-saas.myshopify.com",
    );

    expect(getShopifyCredentialFingerprint()).toEqual({
      apiKeySuffix: "506c",
      appUrl: "https://walk-undertook-professed.ngrok-free.dev",
      redirectUri:
        "https://walk-undertook-professed.ngrok-free.dev/api/auth/callback",
    });
  });
});
