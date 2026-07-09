import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  APP_PROXY_ERROR_CODES,
  buildProxySignaturePayload,
  isValidShopDomain,
  normalizeShopDomain,
  safeTimingEqual,
  verifyShopifyAppProxyRequest,
} from "@/lib/shopifyAppProxy";

const TEST_SECRET = "shpss_test_app_proxy_secret";

function signProxyQueryParams(params, secret = TEST_SECRET) {
  const payload = buildProxySignaturePayload(params);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  return {
    ...params,
    signature,
  };
}

function buildProxyUrl(pathname, params) {
  const url = new URL(pathname, "https://app-proxy.local");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

describe("shopifyAppProxy", () => {
  const originalSecret = process.env.SHOPIFY_API_SECRET;
  const now = 1_700_000_000_000;
  const freshTimestamp = String(Math.floor(now / 1000));

  beforeEach(() => {
    process.env.SHOPIFY_API_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SHOPIFY_API_SECRET;
    } else {
      process.env.SHOPIFY_API_SECRET = originalSecret;
    }
  });

  it("builds duplicate params as comma-joined values before sorting", () => {
    const params = {
      extra: "1,2",
      shop: "demo.myshopify.com",
      timestamp: freshTimestamp,
    };

    expect(buildProxySignaturePayload(params)).toBe(
      `extra=1,2shop=demo.myshopify.comtimestamp=${freshTimestamp}`,
    );
  });

  it("sorts final key=value strings alphabetically before concatenation", () => {
    const params = {
      path_prefix: "/apps/return-radar",
      shop: "demo.myshopify.com",
      timestamp: freshTimestamp,
    };

    expect(buildProxySignaturePayload(params)).toBe(
      `path_prefix=/apps/return-radarshop=demo.myshopify.comtimestamp=${freshTimestamp}`,
    );
  });

  it("concatenates key=value strings with zero separator", () => {
    const params = {
      logged_in_customer_id: "",
      shop: "demo.myshopify.com",
      timestamp: freshTimestamp,
    };

    const payload = buildProxySignaturePayload(params);

    expect(payload.includes("&")).toBe(false);
    expect(payload).toBe(
      `logged_in_customer_id=shop=demo.myshopify.comtimestamp=${freshTimestamp}`,
    );
  });

  it("accepts a valid signature for a fresh timestamp", () => {
    const signed = signProxyQueryParams({
      shop: "demo.myshopify.com",
      timestamp: freshTimestamp,
      path_prefix: "/apps/return-radar",
    });

    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", signed),
      { now },
    );

    expect(result).toEqual({
      ok: true,
      shop: "demo.myshopify.com",
      path: "/api/proxy/return-assistant",
      params: signed,
    });
  });

  it("rejects missing signature", () => {
    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", {
        shop: "demo.myshopify.com",
        timestamp: freshTimestamp,
      }),
      { now },
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: APP_PROXY_ERROR_CODES.SIGNATURE_MISSING,
      message: "Missing app proxy signature.",
    });
  });

  it("rejects invalid signature", () => {
    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", {
        shop: "demo.myshopify.com",
        timestamp: freshTimestamp,
        signature: "deadbeef",
      }),
      { now },
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: APP_PROXY_ERROR_CODES.SIGNATURE_INVALID,
      message: "Invalid app proxy signature.",
    });
  });

  it("comma-joins duplicate query params before signing", () => {
    const signed = signProxyQueryParams({
      extra: "1,2",
      shop: "demo.myshopify.com",
      timestamp: freshTimestamp,
    });

    const url = new URL(
      "/api/proxy/return-assistant",
      "https://app-proxy.local",
    );
    url.searchParams.append("extra", "1");
    url.searchParams.append("extra", "2");
    url.searchParams.set("shop", "demo.myshopify.com");
    url.searchParams.set("timestamp", freshTimestamp);
    url.searchParams.set("signature", signed.signature);

    const result = verifyShopifyAppProxyRequest(url.toString(), { now });

    expect(result.ok).toBe(true);
    expect(result.params?.extra).toBe("1,2");
  });

  it("rejects stale timestamps older than five minutes", () => {
    const staleTimestamp = String(Math.floor((now - 6 * 60 * 1000) / 1000));
    const signed = signProxyQueryParams({
      shop: "demo.myshopify.com",
      timestamp: staleTimestamp,
    });

    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", signed),
      { now },
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      code: APP_PROXY_ERROR_CODES.TIMESTAMP_EXPIRED,
      message: "App proxy timestamp expired.",
    });
  });

  it("accepts fresh timestamps within five minutes", () => {
    const recentTimestamp = String(Math.floor((now - 60 * 1000) / 1000));
    const signed = signProxyQueryParams({
      shop: "demo.myshopify.com",
      timestamp: recentTimestamp,
    });

    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", signed),
      { now },
    );

    expect(result.ok).toBe(true);
  });

  it("rejects invalid shop domains", () => {
    const signed = signProxyQueryParams({
      shop: "evil.example.com",
      timestamp: freshTimestamp,
    });

    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", signed),
      { now },
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      code: APP_PROXY_ERROR_CODES.SHOP_INVALID,
      message: "Invalid shop domain.",
    });
  });

  it("normalizes uppercase shop domains", () => {
    const signed = signProxyQueryParams({
      shop: "DEMO.myshopify.com",
      timestamp: freshTimestamp,
    });

    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", signed),
      { now },
    );

    expect(result.ok).toBe(true);
    expect(result.shop).toBe("demo.myshopify.com");
    expect(normalizeShopDomain("DEMO.myshopify.com")).toBe(
      "demo.myshopify.com",
    );
    expect(isValidShopDomain("DEMO.myshopify.com")).toBe(true);
  });

  it("safeTimingEqual returns false for different length digests", () => {
    expect(safeTimingEqual("abc", "abcd")).toBe(false);
    expect(safeTimingEqual("deadbeef", "deadbee")).toBe(false);
  });

  it("does not leak secrets in verification failures", () => {
    const signed = signProxyQueryParams({
      shop: "demo.myshopify.com",
      timestamp: freshTimestamp,
      signature: "not-a-real-signature-value",
    });

    const result = verifyShopifyAppProxyRequest(
      buildProxyUrl("/api/proxy/return-assistant", {
        ...signed,
        signature: "not-a-real-signature-value",
      }),
      { now },
    );

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(TEST_SECRET);
    expect(serialized).not.toContain("shpss_");
    expect(result.message).not.toContain(TEST_SECRET);
  });
});
