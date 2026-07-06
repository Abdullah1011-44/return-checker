import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockMerchant,
  createMockMerchantB,
} from "./helpers/mockMerchant.js";

const mockRequireMerchant = vi.fn();
const mockLoadMerchantRecoveryAnalytics = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireMerchant: (...args) => mockRequireMerchant(...args),
}));

vi.mock("@/lib/recoveryAnalytics", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadMerchantRecoveryAnalytics: (...args) =>
      mockLoadMerchantRecoveryAnalytics(...args),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/sentry", () => ({
  captureException: (...args) => mockCaptureException(...args),
}));

import { GET } from "@/app/api/dashboard/recovery/route";

const merchant = createMockMerchant();
const otherMerchant = createMockMerchantB();

function buildRecoveryRequest(query = "") {
  const suffix = query ? `?${query}` : "";
  return new Request(`http://localhost/api/dashboard/recovery${suffix}`, {
    method: "GET",
  });
}

function buildAnalyticsPayload(range = "30d") {
  return {
    range,
    timezone: "Australia/Sydney",
    period: {
      startInclusive: "2026-05-17T14:00:00.000Z",
      endExclusive: "2026-06-16T14:00:00.000Z",
    },
    summary: {
      estimatedRefundAvoidedCents: 4500,
      acceptedRecoveryOffers: 3,
      recoveryRate: 0.75,
      averageRecoveryValueCents: 1500,
      pendingOfferDecisions: 1,
      smallSampleCaveat: true,
      ladderEligibleDenominator: 4,
    },
    trend: [
      {
        date: "2026-06-10",
        estimatedRefundAvoidedCents: 1500,
        acceptedRecoveryOffers: 1,
      },
    ],
    offerTypes: [
      {
        type: "EXCHANGE",
        label: "Exchange",
        count: 1,
        estimatedRefundAvoidedCents: 1500,
      },
      {
        type: "STORE_CREDIT",
        label: "Store Credit",
        count: 1,
        estimatedRefundAvoidedCents: 2000,
      },
      {
        type: "PARTIAL_REFUND",
        label: "Partial Refund",
        count: 1,
        estimatedRefundAvoidedCents: 1000,
      },
    ],
    funnel: [
      {
        stage: "ladder_eligible",
        label: "Ladder eligible (submitted in period)",
        count: 4,
      },
      {
        stage: "accepted_recovery",
        label: "Accepted recovery offer (accepted in period)",
        count: 3,
      },
    ],
    topReasons: [
      {
        key: "wrong_size",
        label: "wrong_size",
        count: 2,
        estimatedRefundAvoidedCents: 3000,
      },
    ],
    topProducts: [
      {
        key: "TEE-001",
        label: "Classic Tee (TEE-001)",
        count: 2,
        estimatedRefundAvoidedCents: 3000,
      },
    ],
    queryWindow: {
      submittedAtGte: new Date("2026-05-17T14:00:00.000Z"),
      submittedAtLt: new Date("2026-06-16T14:00:00.000Z"),
      acceptedAtGte: new Date("2026-05-17T14:00:00.000Z"),
      acceptedAtLt: new Date("2026-06-16T14:00:00.000Z"),
    },
  };
}

describe("GET /api/dashboard/recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMerchant.mockResolvedValue(merchant);
    mockLoadMerchantRecoveryAnalytics.mockResolvedValue(
      buildAnalyticsPayload(),
    );
  });

  it("returns 401 for unauthenticated requests", async () => {
    const unauthorized = new Error("Unauthorized");
    unauthorized.status = 401;
    mockRequireMerchant.mockRejectedValue(unauthorized);

    const response = await GET(buildRecoveryRequest("range=30d"));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(mockLoadMerchantRecoveryAnalytics).not.toHaveBeenCalled();
  });

  it("uses the authenticated merchant from requireMerchant", async () => {
    const response = await GET(buildRecoveryRequest("range=30d"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockRequireMerchant).toHaveBeenCalledTimes(1);
    expect(mockLoadMerchantRecoveryAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      merchant.id,
      expect.objectContaining({ range: "30d" }),
    );
    expect(data.success).toBe(true);
    expect(data.range).toBe("30d");
  });

  it("does not allow client merchantId to override the session merchant", async () => {
    const response = await GET(
      buildRecoveryRequest(`range=30d&merchantId=${otherMerchant.id}`),
    );

    expect(response.status).toBe(400);
    expect(mockRequireMerchant).not.toHaveBeenCalled();
    expect(mockLoadMerchantRecoveryAnalytics).not.toHaveBeenCalled();
  });

  it.each(["7d", "30d", "90d"])("accepts supported range %s", async (range) => {
    mockLoadMerchantRecoveryAnalytics.mockResolvedValue(
      buildAnalyticsPayload(range),
    );

    const response = await GET(buildRecoveryRequest(`range=${range}`));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockLoadMerchantRecoveryAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      merchant.id,
      expect.objectContaining({ range }),
    );
    expect(data.range).toBe(range);
  });

  it("defaults to 30d when range is omitted", async () => {
    const response = await GET(buildRecoveryRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockLoadMerchantRecoveryAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      merchant.id,
      expect.objectContaining({ range: "30d" }),
    );
    expect(data.range).toBe("30d");
  });

  it("returns 400 for invalid range", async () => {
    const response = await GET(buildRecoveryRequest("range=14d"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(mockRequireMerchant).not.toHaveBeenCalled();
    expect(mockLoadMerchantRecoveryAnalytics).not.toHaveBeenCalled();
  });

  it("includes funnel in the response", async () => {
    const response = await GET(buildRecoveryRequest("range=30d"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.funnel)).toBe(true);
    expect(data.funnel).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "ladder_eligible", count: 4 }),
        expect.objectContaining({ stage: "accepted_recovery", count: 3 }),
      ]),
    );
  });

  it("returns integer cents fields without formatted currency strings", async () => {
    const response = await GET(buildRecoveryRequest("range=30d"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.summary.estimatedRefundAvoidedCents).toBe(4500);
    expect(data.summary.averageRecoveryValueCents).toBe(1500);
    expect(Number.isInteger(data.summary.estimatedRefundAvoidedCents)).toBe(
      true,
    );
    expect(Number.isInteger(data.trend[0].estimatedRefundAvoidedCents)).toBe(
      true,
    );
    expect(
      Number.isInteger(data.offerTypes[0].estimatedRefundAvoidedCents),
    ).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/\$[0-9]/);
    expect(data.queryWindow).toBeUndefined();
  });

  it("returns a safe zero-data response shape", async () => {
    mockLoadMerchantRecoveryAnalytics.mockResolvedValue({
      range: "30d",
      timezone: "Australia/Sydney",
      period: {
        startInclusive: "2026-05-17T14:00:00.000Z",
        endExclusive: "2026-06-16T14:00:00.000Z",
      },
      summary: {
        estimatedRefundAvoidedCents: 0,
        acceptedRecoveryOffers: 0,
        recoveryRate: 0,
        averageRecoveryValueCents: 0,
        pendingOfferDecisions: 0,
        smallSampleCaveat: true,
        ladderEligibleDenominator: 0,
      },
      trend: [
        {
          date: "2026-06-15",
          estimatedRefundAvoidedCents: 0,
          acceptedRecoveryOffers: 0,
        },
      ],
      offerTypes: [
        {
          type: "EXCHANGE",
          label: "Exchange",
          count: 0,
          estimatedRefundAvoidedCents: 0,
        },
      ],
      funnel: [
        {
          stage: "ladder_eligible",
          label: "Ladder eligible (submitted in period)",
          count: 0,
        },
        {
          stage: "accepted_recovery",
          label: "Accepted recovery offer (accepted in period)",
          count: 0,
        },
      ],
      topReasons: [],
      topProducts: [],
      queryWindow: {},
    });

    const response = await GET(buildRecoveryRequest("range=30d"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.summary.estimatedRefundAvoidedCents).toBe(0);
    expect(data.summary.acceptedRecoveryOffers).toBe(0);
    expect(data.topReasons).toEqual([]);
    expect(data.topProducts).toEqual([]);
    expect(data.timezone).toBe("Australia/Sydney");
    expect(data.period).toMatchObject({
      startInclusive: expect.any(String),
      endExclusive: expect.any(String),
    });
  });
});
