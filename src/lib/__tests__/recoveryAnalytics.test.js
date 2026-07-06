import { describe, expect, it } from "vitest";
import {
  buildRecoveryAnalytics,
  filterAcceptancesForMerchant,
  getSydneyAnalyticsRangeBounds,
  parseRecoveryAnalyticsRange,
} from "@/lib/recoveryAnalytics";

const NOW = new Date("2026-06-15T04:00:00.000Z");

function createAcceptance(overrides = {}) {
  return {
    id: "acceptance-1",
    merchantId: "merchant-a",
    returnRequestId: "return-1",
    returnItemId: "return-item-1",
    acceptedOfferType: "EXCHANGE",
    recoveryAmountCents: 1000,
    legalReviewRequired: false,
    acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
    metadata: { reason: "wrong_size" },
    ...overrides,
  };
}

function buildSubmittedAtMap(entries) {
  return Object.fromEntries(entries);
}

function buildReturnItemMap(entries) {
  return Object.fromEntries(entries);
}

describe("recoveryAnalytics", () => {
  describe("parseRecoveryAnalyticsRange", () => {
    it("defaults to 30d for unknown values", () => {
      expect(parseRecoveryAnalyticsRange(undefined)).toBe("30d");
      expect(parseRecoveryAnalyticsRange("invalid")).toBe("30d");
    });

    it("accepts supported ranges", () => {
      expect(parseRecoveryAnalyticsRange("7d")).toBe("7d");
      expect(parseRecoveryAnalyticsRange("90d")).toBe("90d");
    });
  });

  describe("filterAcceptancesForMerchant", () => {
    it("returns only the requested merchant rows", () => {
      const filtered = filterAcceptancesForMerchant(
        [
          createAcceptance({ merchantId: "merchant-a" }),
          createAcceptance({
            id: "acceptance-2",
            merchantId: "merchant-b",
            returnItemId: "return-item-2",
          }),
        ],
        "merchant-a",
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].merchantId).toBe("merchant-a");
    });
  });

  describe("buildRecoveryAnalytics", () => {
    it("sums persisted recoveryAmountCents snapshots for accepted recovery offers", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
          ["return-2", new Date("2026-06-11T05:00:00.000Z")],
          ["return-3", new Date("2026-06-12T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            returnRequestId: "return-1",
            returnItemId: "item-1",
            recoveryAmountCents: 1500,
          }),
          createAcceptance({
            id: "a2",
            returnRequestId: "return-2",
            returnItemId: "item-2",
            acceptedOfferType: "STORE_CREDIT",
            recoveryAmountCents: 2500,
            acceptedAt: new Date("2026-06-11T05:00:00.000Z"),
          }),
          createAcceptance({
            id: "a3",
            returnRequestId: "return-3",
            returnItemId: "item-3",
            acceptedOfferType: "PARTIAL_REFUND",
            recoveryAmountCents: 500,
            acceptedAt: new Date("2026-06-12T05:00:00.000Z"),
          }),
        ],
      });

      expect(result.summary.estimatedRefundAvoidedCents).toBe(4500);
      expect(result.summary.acceptedRecoveryOffers).toBe(3);
    });

    it("does not recalculate recovery totals from product price", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
        ]),
        returnItemById: buildReturnItemMap([
          [
            "return-item-1",
            {
              reason: "wrong_size",
              orderItem: { productName: "Tee", sku: "TEE-1", price: 999.99 },
            },
          ],
        ]),
        acceptances: [
          createAcceptance({
            recoveryAmountCents: 1234,
          }),
        ],
      });

      expect(result.summary.estimatedRefundAvoidedCents).toBe(1234);
    });

    it("uses acceptedAt for totals and trend buckets", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "7d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
          ["return-2", new Date("2026-06-14T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            returnRequestId: "return-1",
            returnItemId: "item-1",
            recoveryAmountCents: 1000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
          createAcceptance({
            id: "a2",
            returnRequestId: "return-2",
            returnItemId: "item-2",
            acceptedOfferType: "STORE_CREDIT",
            recoveryAmountCents: 2000,
            acceptedAt: new Date("2026-06-14T05:00:00.000Z"),
          }),
          createAcceptance({
            id: "a3",
            returnRequestId: "return-3",
            returnItemId: "item-3",
            acceptedOfferType: "EXCHANGE",
            recoveryAmountCents: 9999,
            acceptedAt: new Date("2026-05-01T05:00:00.000Z"),
          }),
        ],
      });

      expect(result.summary.estimatedRefundAvoidedCents).toBe(3000);
      expect(result.summary.acceptedRecoveryOffers).toBe(2);

      const june10 = result.trend.find((bucket) => bucket.date.endsWith("-10"));
      const june14 = result.trend.find((bucket) => bucket.date.endsWith("-14"));

      expect(june10).toMatchObject({
        acceptedRecoveryOffers: 1,
        estimatedRefundAvoidedCents: 1000,
      });
      expect(june14).toMatchObject({
        acceptedRecoveryOffers: 1,
        estimatedRefundAvoidedCents: 2000,
      });
    });

    it("excludes MANUAL_REVIEW from recovered value and denominator recovery totals", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
          ["return-2", new Date("2026-06-10T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            returnRequestId: "return-1",
            returnItemId: "item-1",
            recoveryAmountCents: 1000,
          }),
          createAcceptance({
            id: "a2",
            returnRequestId: "return-2",
            returnItemId: "item-2",
            acceptedOfferType: "MANUAL_REVIEW",
            recoveryAmountCents: 8000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
        ],
      });

      expect(result.summary.estimatedRefundAvoidedCents).toBe(1000);
      expect(result.summary.acceptedRecoveryOffers).toBe(1);
      expect(result.summary.ladderEligibleDenominator).toBe(1);
      expect(result.summary.pendingOfferDecisions).toBe(1);
    });

    it("excludes LEGAL_REVIEW_REQUIRED and legalReviewRequired=true", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
          ["return-2", new Date("2026-06-10T05:00:00.000Z")],
          ["return-3", new Date("2026-06-10T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            returnRequestId: "return-1",
            returnItemId: "item-1",
            recoveryAmountCents: 1000,
          }),
          createAcceptance({
            id: "a2",
            returnRequestId: "return-2",
            returnItemId: "item-2",
            acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
            recoveryAmountCents: 7000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
          createAcceptance({
            id: "a3",
            returnRequestId: "return-3",
            returnItemId: "item-3",
            acceptedOfferType: "STORE_CREDIT",
            legalReviewRequired: true,
            recoveryAmountCents: 6000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
        ],
      });

      expect(result.summary.estimatedRefundAvoidedCents).toBe(1000);
      expect(result.summary.acceptedRecoveryOffers).toBe(1);
      expect(result.summary.ladderEligibleDenominator).toBe(1);
      expect(result.summary.pendingOfferDecisions).toBe(2);
    });

    it("includes STORE_CREDIT in recovered totals", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            acceptedOfferType: "STORE_CREDIT",
            recoveryAmountCents: 3200,
          }),
        ],
      });

      expect(result.summary.estimatedRefundAvoidedCents).toBe(3200);
      expect(result.offerTypes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "STORE_CREDIT",
            count: 1,
            estimatedRefundAvoidedCents: 3200,
          }),
        ]),
      );
    });

    it("computes average recovery value from accepted offers only", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
          ["return-2", new Date("2026-06-10T05:00:00.000Z")],
          ["return-3", new Date("2026-06-10T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            returnRequestId: "return-1",
            returnItemId: "item-1",
            recoveryAmountCents: 1000,
          }),
          createAcceptance({
            id: "a2",
            returnRequestId: "return-2",
            returnItemId: "item-2",
            acceptedOfferType: "STORE_CREDIT",
            recoveryAmountCents: 3000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
          createAcceptance({
            id: "a3",
            returnRequestId: "return-3",
            returnItemId: "item-3",
            acceptedOfferType: "MANUAL_REVIEW",
            recoveryAmountCents: 9000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
        ],
      });

      expect(result.summary.averageRecoveryValueCents).toBe(2000);
    });

    it("returns a zero-data state when no scoped acceptances exist", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        acceptances: [],
      });

      expect(result.summary).toMatchObject({
        estimatedRefundAvoidedCents: 0,
        acceptedRecoveryOffers: 0,
        recoveryRate: 0,
        averageRecoveryValueCents: 0,
        pendingOfferDecisions: 0,
        smallSampleCaveat: true,
        ladderEligibleDenominator: 0,
      });
      expect(result.trend.length).toBeGreaterThan(0);
      expect(result.offerTypes.every((row) => row.count === 0)).toBe(true);
    });

    it("sets smallSampleCaveat when denominator is below 10", () => {
      const acceptances = Array.from({ length: 9 }, (_, index) =>
        createAcceptance({
          id: `acceptance-${index}`,
          returnRequestId: `return-${index}`,
          returnItemId: `item-${index}`,
          recoveryAmountCents: 1000,
          acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
        }),
      );

      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap(
          acceptances.map((row) => [
            row.returnRequestId,
            new Date("2026-06-10T05:00:00.000Z"),
          ]),
        ),
        acceptances,
      });

      expect(result.summary.ladderEligibleDenominator).toBe(9);
      expect(result.summary.smallSampleCaveat).toBe(true);
    });

    it("clears smallSampleCaveat when denominator reaches 10", () => {
      const acceptances = Array.from({ length: 10 }, (_, index) =>
        createAcceptance({
          id: `acceptance-${index}`,
          returnRequestId: `return-${index}`,
          returnItemId: `item-${index}`,
          recoveryAmountCents: 1000,
          acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
        }),
      );

      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap(
          acceptances.map((row) => [
            row.returnRequestId,
            new Date("2026-06-10T05:00:00.000Z"),
          ]),
        ),
        acceptances,
      });

      expect(result.summary.ladderEligibleDenominator).toBe(10);
      expect(result.summary.smallSampleCaveat).toBe(false);
    });

    it("scopes analytics to the requested merchant only", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
          ["return-2", new Date("2026-06-10T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            merchantId: "merchant-a",
            returnRequestId: "return-1",
            returnItemId: "item-1",
            recoveryAmountCents: 1000,
          }),
          createAcceptance({
            id: "a2",
            merchantId: "merchant-b",
            returnRequestId: "return-2",
            returnItemId: "item-2",
            recoveryAmountCents: 5000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
        ],
      });

      expect(result.summary.estimatedRefundAvoidedCents).toBe(1000);
      expect(result.summary.acceptedRecoveryOffers).toBe(1);
    });

    it("uses ReturnRequest.submittedAt for denominator and acceptedAt for numerator", () => {
      const result = buildRecoveryAnalytics({
        merchantId: "merchant-a",
        now: NOW,
        range: "30d",
        submittedAtByRequestId: buildSubmittedAtMap([
          ["return-1", new Date("2026-06-10T05:00:00.000Z")],
          ["return-2", new Date("2026-06-10T05:00:00.000Z")],
        ]),
        acceptances: [
          createAcceptance({
            returnRequestId: "return-1",
            returnItemId: "item-1",
            recoveryAmountCents: 1000,
            acceptedAt: new Date("2026-05-01T05:00:00.000Z"),
          }),
          createAcceptance({
            id: "a2",
            returnRequestId: "return-2",
            returnItemId: "item-2",
            recoveryAmountCents: 2000,
            acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
          }),
        ],
      });

      expect(result.summary.acceptedRecoveryOffers).toBe(1);
      expect(result.summary.ladderEligibleDenominator).toBe(2);
      expect(result.summary.recoveryRate).toBe(0.5);
    });
  });

  describe("getSydneyAnalyticsRangeBounds", () => {
    it("builds a 30-day Sydney window by default", () => {
      const bounds = getSydneyAnalyticsRangeBounds("30d", NOW);

      expect(bounds.range).toBe("30d");
      expect(bounds.timezone).toBe("Australia/Sydney");
      expect(bounds.days).toBe(30);
      expect(bounds.endExclusive.getTime()).toBeGreaterThan(
        bounds.startInclusive.getTime(),
      );
    });
  });
});
