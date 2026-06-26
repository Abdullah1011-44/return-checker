import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockMerchant } from "./helpers/mockMerchant.js";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";

const mockRequireMerchantForRoute = vi.fn();
const mockSafeCreateAdminAuditLog = vi.fn();
const mockLogUnauthorizedApiAccess = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/merchantApi", () => ({
  requireMerchantForRoute: (...args) => mockRequireMerchantForRoute(...args),
}));

vi.mock("@/lib/adminAudit", () => ({
  ADMIN_AUDIT_ACTORS: { MERCHANT: "MERCHANT", SYSTEM: "SYSTEM" },
  ADMIN_AUDIT_EVENTS: {
    MERCHANT_SETTINGS_UPDATED: "MERCHANT_SETTINGS_UPDATED",
    UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  },
  ADMIN_AUDIT_SEVERITY: { INFO: "INFO", SECURITY: "SECURITY" },
  getAuditRequestContext: () => ({ ipAddress: null, userAgent: null }),
  logUnauthorizedApiAccess: (...args) => mockLogUnauthorizedApiAccess(...args),
  safeCreateAdminAuditLog: (...args) => mockSafeCreateAdminAuditLog(...args),
}));

import { GET, PUT } from "@/app/api/settings/route";
import {
  buildMerchantSettingsAuditMetadata,
  merchantSettingsUpdateSchema,
  serializeMerchantSettings,
} from "@/lib/merchantSettings";

const merchant = createMockMerchant();

const settingsRecord = {
  id: "settings-1",
  merchantId: merchant.id,
  notifyEmail: "merchant@test.com",
  returnWindow: 30,
  autoRejectDays: null,
  aiConfidence: 0.7,
  storeType: "GENERAL",
  allowExchange: true,
  allowKeepItem: false,
  allowPartialRefund: true,
  allowStoreCredit: true,
  freeExchangeShipping: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

function buildSettingsRequest(method, body) {
  return new Request("http://localhost/api/settings", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("merchant settings API", () => {
  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
    mockRequireMerchantForRoute.mockResolvedValue({ merchant });
    mockSafeCreateAdminAuditLog.mockResolvedValue({ id: "audit-1" });
    mockPrisma.merchant.findUnique.mockResolvedValue({
      id: merchant.id,
      email: merchant.email,
      returnWindowDays: 30,
      allowExchange: true,
      allowKeepItem: false,
      allowPartialRefund: true,
      allowStoreCredit: true,
      freeExchangeShipping: false,
    });
    mockPrisma.merchantSettings.upsert.mockResolvedValue(settingsRecord);
    mockPrisma.merchantSettings.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...settingsRecord,
        ...data,
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
    );
  });

  it("GET upserts default settings for authenticated merchant", async () => {
    const response = await GET(buildSettingsRequest("GET"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.settings.returnWindow).toBe(30);
    expect(mockPrisma.merchantSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { merchantId: merchant.id },
        create: expect.objectContaining({
          merchantId: merchant.id,
          notifyEmail: merchant.email,
        }),
      }),
    );
    expect(JSON.stringify(data)).not.toContain("shopifyAccessToken");
  });

  it("GET returns 401 when merchant session is missing", async () => {
    mockRequireMerchantForRoute.mockResolvedValue({
      response: new Response(JSON.stringify({ success: false }), {
        status: 401,
      }),
    });

    const response = await GET(buildSettingsRequest("GET"));
    expect(response.status).toBe(401);
    expect(mockPrisma.merchantSettings.upsert).not.toHaveBeenCalled();
  });

  it("PUT updates settings scoped to authenticated merchant and audits changes", async () => {
    const body = {
      notifyEmail: "alerts@test.com",
      returnWindow: 45,
      autoRejectDays: 14,
      aiConfidence: 0.85,
      storeType: "FASHION",
      allowExchange: true,
      allowKeepItem: false,
      allowPartialRefund: true,
      allowStoreCredit: false,
      freeExchangeShipping: true,
    };

    const response = await PUT(buildSettingsRequest("PUT", body));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.settings.returnWindow).toBe(45);
    expect(mockPrisma.merchantSettings.update).toHaveBeenCalledWith({
      where: { merchantId: merchant.id },
      data: body,
    });
    expect(mockSafeCreateAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: merchant.id,
        eventType: "MERCHANT_SETTINGS_UPDATED",
        metadata: expect.objectContaining({
          action: "MERCHANT_SETTINGS_UPDATED",
          changedFields: expect.arrayContaining(["returnWindow", "storeType"]),
          before: expect.any(Object),
          after: expect.any(Object),
          updatedAt: expect.any(String),
        }),
      }),
    );
  });

  it("PUT rejects invalid settings payload", async () => {
    const response = await PUT(
      buildSettingsRequest("PUT", {
        notifyEmail: "merchant@test.com",
        returnWindow: 0,
        autoRejectDays: null,
        aiConfidence: 1.5,
        storeType: "INVALID",
        allowExchange: true,
        allowKeepItem: false,
        allowPartialRefund: true,
        allowStoreCredit: true,
        freeExchangeShipping: false,
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPrisma.merchantSettings.update).not.toHaveBeenCalled();
  });
});

describe("merchantSettings validation", () => {
  it("accepts null autoRejectDays and valid email", () => {
    const result = merchantSettingsUpdateSchema.safeParse({
      notifyEmail: null,
      returnWindow: 30,
      autoRejectDays: null,
      aiConfidence: 0.5,
      storeType: "GENERAL",
      allowExchange: true,
      allowKeepItem: false,
      allowPartialRefund: true,
      allowStoreCredit: true,
      freeExchangeShipping: false,
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-boolean flags", () => {
    const result = merchantSettingsUpdateSchema.safeParse({
      notifyEmail: "merchant@test.com",
      returnWindow: 30,
      autoRejectDays: null,
      aiConfidence: 0.5,
      storeType: "GENERAL",
      allowExchange: "yes",
      allowKeepItem: false,
      allowPartialRefund: true,
      allowStoreCredit: true,
      freeExchangeShipping: false,
    });

    expect(result.success).toBe(false);
  });

  it("buildMerchantSettingsAuditMetadata only includes changed fields", () => {
    const before = settingsRecord;
    const after = {
      ...settingsRecord,
      returnWindow: 45,
      allowStoreCredit: false,
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    };

    const metadata = buildMerchantSettingsAuditMetadata(before, after);

    expect(metadata.changedFields).toEqual([
      "returnWindow",
      "allowStoreCredit",
    ]);
    expect(metadata.before).toEqual({
      returnWindow: 30,
      allowStoreCredit: true,
    });
    expect(metadata.after).toEqual({
      returnWindow: 45,
      allowStoreCredit: false,
    });
    expect(serializeMerchantSettings(after).updatedAt).toBe(
      "2026-01-03T00:00:00.000Z",
    );
  });
});
