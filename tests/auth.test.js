import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockMerchant } from "./helpers/mockMerchant.js";
import { mockPrisma } from "./helpers/mockPrisma.js";

const mockCookieGet = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mockCookieGet,
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

import { getCurrentMerchant, requireMerchant } from "@/lib/auth";
import {
  encodeMerchantSessionToken,
  MERCHANT_SESSION_COOKIE,
} from "@/lib/merchantSession";

function setSessionCookie(token) {
  mockCookieGet.mockImplementation((name) =>
    name === MERCHANT_SESSION_COOKIE ? { value: token } : undefined
  );
}

describe("merchant authentication", () => {
  const originalSessionSecret = process.env.MERCHANT_SESSION_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MERCHANT_SESSION_SECRET = "test-merchant-session-secret";
  });

  afterEach(() => {
    if (originalSessionSecret === undefined) {
      delete process.env.MERCHANT_SESSION_SECRET;
    } else {
      process.env.MERCHANT_SESSION_SECRET = originalSessionSecret;
    }
  });

  describe("getCurrentMerchant", () => {
    it("returns null when merchant_session cookie is missing", async () => {
      mockCookieGet.mockReturnValue(undefined);

      const result = await getCurrentMerchant();

      expect(result).toBeNull();
      expect(mockPrisma.merchant.findFirst).not.toHaveBeenCalled();
    });

    it("returns null when merchant_session cookie is invalid", async () => {
      setSessionCookie("not-a-valid-session-token");

      const result = await getCurrentMerchant();

      expect(result).toBeNull();
      expect(mockPrisma.merchant.findFirst).not.toHaveBeenCalled();
    });

    it("resolves to merchant when session is valid", async () => {
      const merchant = createMockMerchant();
      const token = encodeMerchantSessionToken({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
      });

      setSessionCookie(token);
      mockPrisma.merchant.findFirst.mockResolvedValue(merchant);

      const result = await getCurrentMerchant();

      expect(result).toEqual(merchant);
      expect(mockPrisma.merchant.findFirst).toHaveBeenCalledOnce();
      expect(mockPrisma.merchant.findFirst).toHaveBeenCalledWith({
        where: {
          id: merchant.id,
          shopDomain: merchant.shopDomain,
          isActive: true,
        },
        select: {
          id: true,
          shopDomain: true,
          shopName: true,
          email: true,
          role: true,
          isActive: true,
          shopifyInstalledAt: true,
        },
      });
    });

    it("returns null when merchant is inactive", async () => {
      const merchant = createMockMerchant({ isActive: false });
      const token = encodeMerchantSessionToken({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
      });

      setSessionCookie(token);
      mockPrisma.merchant.findFirst.mockResolvedValue(null);

      const result = await getCurrentMerchant();

      expect(result).toBeNull();
      expect(mockPrisma.merchant.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        })
      );
    });
  });

  describe("requireMerchant", () => {
    it("throws Unauthorized when merchant_session is missing", async () => {
      mockCookieGet.mockReturnValue(undefined);

      await expect(requireMerchant()).rejects.toMatchObject({
        message: "Unauthorized",
        status: 401,
      });
    });

    it("throws Unauthorized when merchant_session is invalid", async () => {
      setSessionCookie("tampered.session.token");

      await expect(requireMerchant()).rejects.toMatchObject({
        message: "Unauthorized",
        status: 401,
      });
    });

    it("returns merchant when session is valid", async () => {
      const merchant = createMockMerchant();
      const token = encodeMerchantSessionToken({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
      });

      setSessionCookie(token);
      mockPrisma.merchant.findFirst.mockResolvedValue(merchant);

      const result = await requireMerchant();

      expect(result).toEqual(merchant);
    });

    it("throws Unauthorized when merchant is inactive", async () => {
      const merchant = createMockMerchant({ isActive: false });
      const token = encodeMerchantSessionToken({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
      });

      setSessionCookie(token);
      mockPrisma.merchant.findFirst.mockResolvedValue(null);

      await expect(requireMerchant()).rejects.toMatchObject({
        message: "Unauthorized",
        status: 401,
      });
    });
  });
});
