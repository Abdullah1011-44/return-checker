import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockMerchant } from "./helpers/mockMerchant.js";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";
import { DEFAULT_MERCHANT_RECOVERY_RULES } from "@/lib/merchantRecoveryRules";

const mockRequireMerchantForRoute = vi.fn();
const mockSafeCreateAdminAuditLog = vi.fn();
const mockLogUnauthorizedApiAccess = vi.fn();
const mockLogAuditInfo = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/merchantApi", () => ({
  requireMerchantForRoute: (...args) => mockRequireMerchantForRoute(...args),
}));

vi.mock("@/lib/adminAudit", () => ({
  ADMIN_AUDIT_ACTORS: { MERCHANT: "MERCHANT", SYSTEM: "SYSTEM" },
  ADMIN_AUDIT_EVENTS: {
    MERCHANT_RECOVERY_RULES_UPDATED: "MERCHANT_RECOVERY_RULES_UPDATED",
    UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  },
  ADMIN_AUDIT_SEVERITY: { INFO: "INFO", SECURITY: "SECURITY" },
  getAuditRequestContext: () => ({ ipAddress: null, userAgent: null }),
  logUnauthorizedApiAccess: (...args) => mockLogUnauthorizedApiAccess(...args),
  safeCreateAdminAuditLog: (...args) => mockSafeCreateAdminAuditLog(...args),
}));

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTORS: { MERCHANT: "MERCHANT" },
  AUDIT_EVENTS: {
    MERCHANT_RECOVERY_RULES_UPDATED: "MERCHANT_RECOVERY_RULES_UPDATED",
  },
  logAuditInfo: (...args) => mockLogAuditInfo(...args),
}));

import { GET, PUT } from "@/app/api/merchant/recovery-rules/route";

const merchant = createMockMerchant();
const otherMerchant = createMockMerchant({ id: "merchant-other" });

function buildRuleRecords(merchantId, overrides = {}) {
  return DEFAULT_MERCHANT_RECOVERY_RULES.map((template, index) => ({
    id: `rule-${merchantId}-${index + 1}`,
    merchantId,
    type: template.type,
    name: template.name,
    enabled: template.enabled,
    priority: template.priority,
    conditions: template.conditions,
    actions: template.actions,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ...(overrides[template.type] ?? {}),
  }));
}

function buildPutBody(overrides = {}) {
  return {
    rules: DEFAULT_MERCHANT_RECOVERY_RULES.map((template) => ({
      type: template.type,
      name: template.name,
      enabled: template.enabled,
      priority: template.priority,
      conditions: template.conditions,
      actions: { ...template.actions },
      ...(overrides[template.type] ?? {}),
    })),
  };
}

function buildRequest(method, body) {
  return new Request("http://localhost/api/merchant/recovery-rules", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function setupGetWithRules(rules) {
  mockPrisma.merchantRecoveryRule.findMany.mockResolvedValue(rules);
}

function setupGetSeeding() {
  const seeded = buildRuleRecords(merchant.id);
  mockPrisma.merchantRecoveryRule.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(seeded);
  mockPrisma.merchantRecoveryRule.upsert.mockImplementation(({ create }) =>
    Promise.resolve({
      ...create,
      id: `seed-${create.type}`,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    }),
  );
  return seeded;
}

function setupPutTransaction(beforeRules, afterRules) {
  mockPrisma.merchantRecoveryRule.findMany
    .mockResolvedValueOnce(beforeRules)
    .mockResolvedValueOnce(afterRules);
  mockPrisma.merchantRecoveryRule.upsert.mockImplementation(
    ({ create, update, where }) =>
      Promise.resolve({
        id: `rule-${where.merchantId_type.type}`,
        merchantId: where.merchantId_type.merchantId,
        type: where.merchantId_type.type,
        ...create,
        ...update,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
  );
}

describe("merchant recovery rules API", () => {
  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
    mockRequireMerchantForRoute.mockResolvedValue({ merchant });
    mockSafeCreateAdminAuditLog.mockResolvedValue({ id: "audit-1" });
  });

  it("GET requires merchant auth", async () => {
    mockRequireMerchantForRoute.mockResolvedValue({
      response: new Response(JSON.stringify({ success: false }), {
        status: 401,
      }),
    });

    const response = await GET(buildRequest("GET"));
    expect(response.status).toBe(401);
    expect(mockPrisma.merchantRecoveryRule.findMany).not.toHaveBeenCalled();
  });

  it("GET returns only the authenticated merchant rules", async () => {
    const merchantRules = buildRuleRecords(merchant.id);
    const otherRules = buildRuleRecords(otherMerchant.id);
    setupGetWithRules(merchantRules);

    const response = await GET(buildRequest("GET"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.rules).toHaveLength(4);
    expect(mockPrisma.merchantRecoveryRule.findMany).toHaveBeenCalledWith({
      where: { merchantId: merchant.id },
    });
    expect(data.rules.map((rule) => rule.id)).toEqual(
      merchantRules.map((rule) => rule.id),
    );
    expect(data.rules.map((rule) => rule.id)).not.toEqual(
      otherRules.map((rule) => rule.id),
    );
    expect(JSON.stringify(data)).not.toContain("shopifyAccessToken");
  });

  it("GET seeds safe defaults when merchant has no rules", async () => {
    const seeded = setupGetSeeding();

    const response = await GET(buildRequest("GET"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.rules).toHaveLength(4);
    expect(data.rules[0].type).toBe("EXCHANGE");
    expect(data.rules[0].enabled).toBe(true);
    expect(data.rules[2].type).toBe("PARTIAL_REFUND");
    expect(data.rules[2].enabled).toBe(false);
    expect(mockPrisma.merchantRecoveryRule.upsert).toHaveBeenCalledTimes(4);
    expect(seeded.map((rule) => rule.priority)).toEqual([1, 2, 3, 4]);
  });

  it("repeated GET does not create duplicate default rules", async () => {
    const existing = buildRuleRecords(merchant.id);
    setupGetWithRules(existing);

    await GET(buildRequest("GET"));
    await GET(buildRequest("GET"));

    expect(mockPrisma.merchantRecoveryRule.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.merchantRecoveryRule.findMany).toHaveBeenCalledTimes(2);
  });

  it("PUT requires merchant auth", async () => {
    mockRequireMerchantForRoute.mockResolvedValue({
      response: new Response(JSON.stringify({ success: false }), {
        status: 401,
      }),
    });

    const response = await PUT(buildRequest("PUT", buildPutBody()));
    expect(response.status).toBe(401);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("PUT rejects REFUND rule type", async () => {
    const body = buildPutBody({
      EXCHANGE: { type: "REFUND" },
    });

    const response = await PUT(buildRequest("PUT", body));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.details?.[0]?.message).toMatch(/REFUND/);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("PUT rejects FULL_REFUND and DISCOUNT_TO_KEEP rule types", async () => {
    for (const disallowed of ["FULL_REFUND", "DISCOUNT_TO_KEEP"]) {
      const body = buildPutBody({
        EXCHANGE: { type: disallowed },
      });

      const response = await PUT(buildRequest("PUT", body));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.details?.[0]?.message).toMatch(new RegExp(disallowed));
    }
  });

  it("PUT rejects invalid priority values", async () => {
    const invalidCases = [
      { label: "string", priority: "high" },
      { label: "decimal", priority: 1.5 },
      { label: "below minimum", priority: 0 },
      { label: "above maximum", priority: 1000 },
    ];

    for (const testCase of invalidCases) {
      const body = buildPutBody({
        EXCHANGE: { priority: testCase.priority },
      });

      const response = await PUT(buildRequest("PUT", body));
      expect(response.status).toBe(400);
    }
  });

  it("PUT rejects duplicate rule types", async () => {
    const body = buildPutBody();
    body.rules[1] = { ...body.rules[0] };

    const response = await PUT(buildRequest("PUT", body));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.details?.[0]?.message).toMatch(/Duplicate rule types/);
  });

  it("PUT rejects duplicate priorities", async () => {
    const body = buildPutBody({
      STORE_CREDIT: { priority: 1 },
    });

    const response = await PUT(buildRequest("PUT", body));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.details?.[0]?.message).toMatch(/Duplicate priority/);
  });

  it("PUT rejects merchantId in request body", async () => {
    const topLevel = { ...buildPutBody(), merchantId: merchant.id };
    const nested = buildPutBody({
      EXCHANGE: { merchantId: merchant.id },
    });

    for (const body of [topLevel, nested]) {
      const response = await PUT(buildRequest("PUT", body));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.details?.[0]?.message).toMatch(/merchantId/);
    }
  });

  it("PUT only updates the authenticated merchant rules", async () => {
    const beforeRules = buildRuleRecords(merchant.id);
    const afterRules = buildRuleRecords(merchant.id, {
      EXCHANGE: { enabled: false, priority: 1 },
    });
    setupPutTransaction(beforeRules, afterRules);

    const body = buildPutBody({
      EXCHANGE: { enabled: false },
    });

    const response = await PUT(buildRequest("PUT", body));
    expect(response.status).toBe(200);

    for (const call of mockPrisma.merchantRecoveryRule.upsert.mock.calls) {
      expect(call[0].where.merchantId_type.merchantId).toBe(merchant.id);
      expect(call[0].where.merchantId_type.merchantId).not.toBe(
        otherMerchant.id,
      );
    }
  });

  it("PUT rejects PARTIAL_REFUND with requiresApproval false", async () => {
    const body = buildPutBody({
      PARTIAL_REFUND: {
        actions: {
          maxRefundPercent: 20,
          requiresApproval: false,
          message: "Partial refund requires merchant approval.",
        },
      },
    });

    const response = await PUT(buildRequest("PUT", body));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.details?.[0]?.message).toMatch(/approval/i);
  });

  it("PUT rejects autoRefund true in actions", async () => {
    const body = buildPutBody({
      EXCHANGE: {
        actions: {
          message: "Bad action",
          autoRefund: true,
        },
      },
    });

    const response = await PUT(buildRequest("PUT", body));
    expect(response.status).toBe(400);
  });

  it("PUT validates minOrderValue and maxOrderValue when provided", async () => {
    const invalidBody = buildPutBody({
      EXCHANGE: {
        conditions: { minOrderValue: 100, maxOrderValue: 50 },
      },
    });

    const invalidResponse = await PUT(buildRequest("PUT", invalidBody));
    expect(invalidResponse.status).toBe(400);

    const validBody = buildPutBody({
      EXCHANGE: {
        conditions: { minOrderValue: 50, maxOrderValue: 100 },
      },
    });
    const beforeRules = buildRuleRecords(merchant.id);
    const afterRules = buildRuleRecords(merchant.id, {
      EXCHANGE: { conditions: { minOrderValue: 50, maxOrderValue: 100 } },
    });
    setupPutTransaction(beforeRules, afterRules);

    const validResponse = await PUT(buildRequest("PUT", validBody));
    expect(validResponse.status).toBe(200);
  });

  it("writes audit log on successful update", async () => {
    const beforeRules = buildRuleRecords(merchant.id);
    const afterRules = buildRuleRecords(merchant.id, {
      MANUAL_REVIEW: { enabled: false },
    });
    setupPutTransaction(beforeRules, afterRules);

    const body = buildPutBody({
      MANUAL_REVIEW: { enabled: false },
    });

    const response = await PUT(buildRequest("PUT", body));
    expect(response.status).toBe(200);

    expect(mockLogAuditInfo).toHaveBeenCalledWith(
      "MERCHANT_RECOVERY_RULES_UPDATED",
      expect.objectContaining({
        merchantId: merchant.id,
        changedFields: expect.arrayContaining(["MANUAL_REVIEW"]),
      }),
    );

    expect(mockSafeCreateAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: merchant.id,
        eventType: "MERCHANT_RECOVERY_RULES_UPDATED",
        metadata: expect.objectContaining({
          action: "MERCHANT_RECOVERY_RULES_UPDATED",
          changedFields: expect.arrayContaining(["MANUAL_REVIEW"]),
        }),
      }),
    );
  });

  it("audit metadata does not include sensitive fields", async () => {
    const beforeRules = buildRuleRecords(merchant.id);
    const afterRules = buildRuleRecords(merchant.id, {
      STORE_CREDIT: {
        actions: {
          bonusPercent: 5,
          message: "Offer store credit.",
        },
      },
    });
    setupPutTransaction(beforeRules, afterRules);

    const body = buildPutBody({
      STORE_CREDIT: {
        actions: {
          bonusPercent: 5,
          message: "Offer store credit.",
        },
      },
    });

    await PUT(buildRequest("PUT", body));

    const auditCall = mockSafeCreateAdminAuditLog.mock.calls[0]?.[0];
    const metadata = JSON.stringify(auditCall?.metadata ?? {});

    for (const forbidden of [
      "shopifyAccessToken",
      "accessToken",
      "cookie",
      "customerEmail",
      '"email"',
      '"phone"',
      '"address"',
      "orderNumber",
    ]) {
      expect(metadata.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
