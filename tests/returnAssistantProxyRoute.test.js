import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildProxySignaturePayload } from "@/lib/shopifyAppProxy";
import { createMockMerchant } from "./helpers/mockMerchant.js";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";

const mockGetCurrentMerchant = vi.fn();
const mockRateLimit = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentMerchant: (...args) => mockGetCurrentMerchant(...args),
}));

vi.mock("@/lib/sentry", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/rateLimit", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rateLimit: (...args) => mockRateLimit(...args),
    resetRateLimitStoreForTests: actual.resetRateLimitStoreForTests,
  };
});

import { GET, POST } from "@/app/api/proxy/return-assistant/route";
import { RETURN_ASSISTANT_PROXY_ERROR_CODES } from "@/lib/returnAssistantStorefront";

const TEST_SECRET = "shpss_test_app_proxy_secret";
const SHOP_DOMAIN = "demo.myshopify.com";
const PROXY_PATH = "/api/proxy/return-assistant";

function currentProxyTimestamp() {
  return String(Math.floor(Date.now() / 1000));
}

const SECRET_ENV_KEYS = {
  SUPABASE_SERVICE_ROLE_KEY: "supabase_service_role_test_key",
  ANTHROPIC_API_KEY: "sk-ant-test-key",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
};

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

function buildSignedProxyUrl(pathname, params, secret = TEST_SECRET) {
  const signed = signProxyQueryParams(params, secret);
  const url = new URL(pathname, "https://app-proxy.local");
  for (const [key, value] of Object.entries(signed)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function buildSignedGetRequest(params = {}, secret = TEST_SECRET) {
  return new Request(
    buildSignedProxyUrl(
      PROXY_PATH,
      {
        shop: SHOP_DOMAIN,
        timestamp: currentProxyTimestamp(),
        ...params,
      },
      secret,
    ),
    {
      method: "GET",
      headers: {
        "x-forwarded-for": "203.0.113.10",
      },
    },
  );
}

function buildSignedPostRequest(body, params = {}, secret = TEST_SECRET) {
  const url = buildSignedProxyUrl(
    PROXY_PATH,
    {
      shop: SHOP_DOMAIN,
      timestamp: currentProxyTimestamp(),
      ...params,
    },
    secret,
  );

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("return assistant proxy route", () => {
  const originalEnv = { ...process.env };
  const activeMerchant = createMockMerchant({
    id: "merchant-proxy-1",
    shopDomain: SHOP_DOMAIN,
    isActive: true,
    shopifyInstalledAt: new Date("2024-01-01T00:00:00.000Z"),
    shopifyUninstalledAt: null,
  });

  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = TEST_SECRET;
    Object.assign(process.env, SECRET_ENV_KEYS);

    mockGetCurrentMerchant.mockResolvedValue(null);
    mockRateLimit.mockReturnValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
      limit: 60,
    });
    mockPrisma.merchant.findFirst.mockResolvedValue(activeMerchant);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET with valid signature and active merchant returns bootstrap JSON", async () => {
    const response = await GET(buildSignedGetRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(data).toEqual({
      ok: true,
      enabled: true,
      mode: "return-assistant",
      shop: SHOP_DOMAIN,
      copy: {
        title: "Return Assistant",
        greeting: "We'll help you start your return.",
      },
      features: {
        chatUi: false,
        orderVerification: false,
        productSelection: false,
        imageUpload: false,
        dynamicFollowUps: false,
        aiOfferPresentation: false,
      },
    });
    expect(mockGetCurrentMerchant).not.toHaveBeenCalled();
  });

  it("GET missing signature returns 401", async () => {
    const url = new URL(PROXY_PATH, "https://app-proxy.local");
    url.searchParams.set("shop", SHOP_DOMAIN);
    url.searchParams.set("timestamp", currentProxyTimestamp());

    const response = await GET(new Request(url.toString(), { method: "GET" }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(mockPrisma.merchant.findFirst).not.toHaveBeenCalled();
  });

  it("GET wrong signature returns 401", async () => {
    const response = await GET(
      buildSignedGetRequest({}, "wrong-secret-value-12345"),
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(mockPrisma.merchant.findFirst).not.toHaveBeenCalled();
  });

  it("GET missing shop returns 401", async () => {
    const signed = signProxyQueryParams({
      timestamp: currentProxyTimestamp(),
    });
    const url = new URL(PROXY_PATH, "https://app-proxy.local");
    url.searchParams.set("timestamp", signed.timestamp);
    url.searchParams.set("signature", signed.signature);

    const response = await GET(new Request(url.toString(), { method: "GET" }));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(mockPrisma.merchant.findFirst).not.toHaveBeenCalled();
  });

  it("GET inactive merchant returns 403", async () => {
    mockPrisma.merchant.findFirst.mockResolvedValue(null);

    const response = await GET(buildSignedGetRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data).toEqual({
      ok: false,
      code: RETURN_ASSISTANT_PROXY_ERROR_CODES.MERCHANT_UNAVAILABLE,
      message: "Store unavailable.",
    });
  });

  it("GET does not include shopifyAccessToken", async () => {
    mockPrisma.merchant.findFirst.mockResolvedValue({
      ...activeMerchant,
      shopifyAccessToken: "shpat_secret_token_should_not_leak",
    });

    const response = await GET(buildSignedGetRequest());
    const text = await response.text();

    expect(text).not.toContain("shpat_");
    expect(text).not.toContain("shopifyAccessToken");
  });

  it("GET does not include private environment secrets", async () => {
    const response = await GET(buildSignedGetRequest());
    const text = await response.text();

    for (const secret of Object.values(SECRET_ENV_KEYS)) {
      expect(text).not.toContain(secret);
    }
  });

  it("POST accepts launcher_opened", async () => {
    const response = await POST(
      buildSignedPostRequest({
        event: "launcher_opened",
        mode: "floating",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mockGetCurrentMerchant).not.toHaveBeenCalled();
  });

  it("POST rejects unknown event", async () => {
    const response = await POST(
      buildSignedPostRequest({
        event: "chat_message_sent",
        message: "hello",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.code).toBe(RETURN_ASSISTANT_PROXY_ERROR_CODES.INVALID_EVENT);
  });

  it("POST rejects payload over 1024 bytes", async () => {
    const response = await POST(
      buildSignedPostRequest(
        JSON.stringify({
          event: "launcher_opened",
          padding: "x".repeat(1100),
        }),
      ),
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe(
      RETURN_ASSISTANT_PROXY_ERROR_CODES.PAYLOAD_TOO_LARGE,
    );
  });

  it("POST invalid JSON returns 400", async () => {
    const response = await POST(buildSignedPostRequest("{not-json"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.code).toBe(RETURN_ASSISTANT_PROXY_ERROR_CODES.INVALID_JSON);
  });

  it("route does not rely on merchant session cookies", async () => {
    await GET(buildSignedGetRequest());
    await POST(buildSignedPostRequest({ event: "inline_viewed" }));

    expect(mockGetCurrentMerchant).not.toHaveBeenCalled();
  });

  it("rate-limit key includes shop domain", async () => {
    await GET(buildSignedGetRequest());

    expect(mockRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.stringContaining(`return-assistant-proxy:${SHOP_DOMAIN}:`),
      }),
    );
  });
});
