import { describe, expect, it, vi } from "vitest";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";
import {
  aggregateOfferAcceptanceMetrics,
  buildOfferAcceptanceByReturnItemId,
  dedupeOfferAcceptancesByReturnItemId,
  formatRecoveredAmountDisplay,
  loadMerchantOfferAcceptances,
  mapOfferAcceptanceToDashboardItem,
  normalizeAcceptedOfferTypeForAnalytics,
  normalizeOfferSourceForAnalytics,
} from "@/lib/offerAcceptanceAnalytics";

function createAcceptance(overrides = {}) {
  return {
    id: "acceptance-1",
    merchantId: "merchant-a",
    returnRequestId: "return-1",
    returnItemId: "return-item-1",
    acceptedOfferType: "EXCHANGE",
    offerSource: "CUSTOMER_SELECTED",
    recoveryAmountCents: 2999,
    currency: "AUD",
    legalReviewRequired: false,
    acceptedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

describe("offerAcceptanceAnalytics", () => {
  describe("aggregateOfferAcceptanceMetrics", () => {
    it("computes correct aggregate counts by offer type", () => {
      const acceptances = [
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 1000,
        }),
        createAcceptance({
          id: "acceptance-2",
          returnItemId: "item-2",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 2000,
        }),
        createAcceptance({
          id: "acceptance-3",
          returnItemId: "item-3",
          acceptedOfferType: "PARTIAL_REFUND",
          recoveryAmountCents: 500,
        }),
        createAcceptance({
          id: "acceptance-4",
          returnItemId: "item-4",
          acceptedOfferType: "MANUAL_REVIEW",
          recoveryAmountCents: 9999,
        }),
        createAcceptance({
          id: "acceptance-5",
          returnItemId: "item-5",
          acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
          recoveryAmountCents: 8888,
        }),
      ];

      const summary = aggregateOfferAcceptanceMetrics(acceptances);

      expect(summary.totalAcceptedOffers).toBe(5);
      expect(summary.acceptedExchangeCount).toBe(1);
      expect(summary.acceptedStoreCreditCount).toBe(1);
      expect(summary.acceptedPartialRefundCount).toBe(1);
      expect(summary.manualReviewCount).toBe(1);
      expect(summary.legalReviewRequiredCount).toBe(1);
      expect(summary.acceptanceByOfferType).toMatchObject({
        EXCHANGE: 1,
        STORE_CREDIT: 1,
        PARTIAL_REFUND: 1,
        MANUAL_REVIEW: 1,
        LEGAL_REVIEW_REQUIRED: 1,
      });
    });

    it("includes exchange, store credit, and partial refund in recovery total", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 1000,
        }),
        createAcceptance({
          id: "a2",
          returnItemId: "item-2",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 2000,
        }),
        createAcceptance({
          id: "a3",
          returnItemId: "item-3",
          acceptedOfferType: "PARTIAL_REFUND",
          recoveryAmountCents: 500,
        }),
      ]);

      expect(summary.estimatedRecoveredAmountCents).toBe(3500);
      expect(summary.estimatedRecoveredAmountDisplay).toBe(
        formatRecoveredAmountDisplay(3500, "AUD"),
      );
    });

    it("excludes manual review from recovery total", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 1000,
        }),
        createAcceptance({
          id: "a2",
          returnItemId: "item-2",
          acceptedOfferType: "MANUAL_REVIEW",
          recoveryAmountCents: 5000,
        }),
      ]);

      expect(summary.estimatedRecoveredAmountCents).toBe(1000);
    });

    it("excludes legal review required from recovery total and counts separately", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 1500,
        }),
        createAcceptance({
          id: "a2",
          returnItemId: "item-2",
          acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
          recoveryAmountCents: 9000,
        }),
      ]);

      expect(summary.estimatedRecoveredAmountCents).toBe(1500);
      expect(summary.legalReviewRequiredCount).toBe(1);
    });

    it("uses persisted recoveryAmountCents only, not client-side order values", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 1234,
          clientSubmittedRecoveryCents: 999999,
          orderItemPrice: 50000,
        }),
      ]);

      expect(summary.estimatedRecoveredAmountCents).toBe(1234);
    });

    it("treats missing acceptance records safely without crashing", () => {
      expect(aggregateOfferAcceptanceMetrics(null)).toMatchObject({
        totalAcceptedOffers: 0,
        estimatedRecoveredAmountCents: 0,
      });
      expect(aggregateOfferAcceptanceMetrics(undefined)).toMatchObject({
        totalAcceptedOffers: 0,
      });
      expect(aggregateOfferAcceptanceMetrics([])).toMatchObject({
        totalAcceptedOffers: 0,
      });
    });

    it("treats missing or unknown recovery amounts as zero", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: null,
        }),
        createAcceptance({
          id: "a2",
          returnItemId: "item-2",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: "not-a-number",
        }),
      ]);

      expect(summary.estimatedRecoveredAmountCents).toBe(0);
    });

    it("handles unknown offer type safely as manual review", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "MYSTERY_OFFER",
          recoveryAmountCents: 4000,
        }),
      ]);

      expect(summary.manualReviewCount).toBe(1);
      expect(summary.estimatedRecoveredAmountCents).toBe(0);
      expect(summary.acceptanceByOfferType.MANUAL_REVIEW).toBe(1);
    });

    it("does not double-count when current-state overwrite produces duplicate returnItemId rows", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-1",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 1000,
        }),
        createAcceptance({
          id: "acceptance-overwrite",
          returnItemId: "item-1",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 2500,
        }),
      ]);

      expect(summary.totalAcceptedOffers).toBe(1);
      expect(summary.acceptedStoreCreditCount).toBe(1);
      expect(summary.acceptedExchangeCount).toBe(0);
      expect(summary.estimatedRecoveredAmountCents).toBe(2500);
    });

    it("counts acceptance by source for all valid sources", () => {
      const sources = [
        "CUSTOMER_SELECTED",
        "RULE_ENGINE",
        "FOLLOW_UP_ENGINE",
        "MERCHANT_MANUAL",
        "SYSTEM_DEFAULT",
      ];

      const acceptances = sources.map((offerSource, index) =>
        createAcceptance({
          id: `acceptance-${index}`,
          returnItemId: `item-${index}`,
          offerSource,
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 100,
        }),
      );

      const summary = aggregateOfferAcceptanceMetrics(acceptances);

      for (const source of sources) {
        expect(summary.acceptanceBySource[source]).toBe(1);
      }
    });

    it("maps AI-like offer sources to SYSTEM_DEFAULT and excludes them from named AI buckets", () => {
      const summary = aggregateOfferAcceptanceMetrics([
        createAcceptance({
          returnItemId: "item-ai",
          offerSource: "AI_ENGINE",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 100,
        }),
        createAcceptance({
          id: "a2",
          returnItemId: "item-claude",
          offerSource: "ANTHROPIC",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 200,
        }),
      ]);

      expect(summary.acceptanceBySource.SYSTEM_DEFAULT).toBe(2);
      expect(summary.acceptanceBySource.AI_ENGINE).toBeUndefined();
      expect(summary.acceptanceBySource.ANTHROPIC).toBeUndefined();
    });
  });

  describe("loadMerchantOfferAcceptances", () => {
    it("queries only the requested merchantId", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prisma = { returnOfferAcceptance: { findMany } };

      await loadMerchantOfferAcceptances(prisma, "merchant-a");

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { merchantId: "merchant-a" },
        }),
      );
    });

    it("merchant only sees their own offer acceptance records via scoped query", async () => {
      const merchantARecords = [
        createAcceptance({ merchantId: "merchant-a", returnItemId: "a-item" }),
      ];
      const merchantBRecords = [
        createAcceptance({
          id: "b1",
          merchantId: "merchant-b",
          returnItemId: "b-item",
        }),
      ];

      const allRecords = [...merchantARecords, ...merchantBRecords];
      const findMany = vi.fn(async ({ where }) =>
        allRecords.filter((record) => record.merchantId === where.merchantId),
      );
      const prisma = { returnOfferAcceptance: { findMany } };

      const merchantAData = await loadMerchantOfferAcceptances(
        prisma,
        "merchant-a",
      );
      const merchantBData = await loadMerchantOfferAcceptances(
        prisma,
        "merchant-b",
      );

      expect(merchantAData).toHaveLength(1);
      expect(merchantAData[0].returnItemId).toBe("a-item");
      expect(merchantBData).toHaveLength(1);
      expect(merchantBData[0].returnItemId).toBe("b-item");
    });
  });

  describe("mapOfferAcceptanceToDashboardItem", () => {
    it("maps persisted acceptance fields for dashboard display", () => {
      const mapped = mapOfferAcceptanceToDashboardItem(
        createAcceptance({
          acceptedOfferType: "PARTIAL_REFUND",
          recoveryAmountCents: 1500,
        }),
      );

      expect(mapped).toMatchObject({
        acceptedOfferType: "PARTIAL_REFUND",
        acceptedOfferLabel: "Partial Refund",
        estimatedRecoveredAmountCents: 1500,
        offerSource: "CUSTOMER_SELECTED",
      });
      expect(mapped.estimatedRecoveredAmountDisplay).toBe(
        formatRecoveredAmountDisplay(1500, "AUD"),
      );
    });

    it("returns null when acceptance is missing", () => {
      expect(mapOfferAcceptanceToDashboardItem(null)).toBeNull();
      expect(mapOfferAcceptanceToDashboardItem(undefined)).toBeNull();
    });
  });

  describe("dedupeOfferAcceptancesByReturnItemId", () => {
    it("keeps the last record per returnItemId", () => {
      const deduped = dedupeOfferAcceptancesByReturnItemId([
        createAcceptance({ returnItemId: "item-1", recoveryAmountCents: 100 }),
        createAcceptance({
          id: "a2",
          returnItemId: "item-1",
          recoveryAmountCents: 200,
        }),
        createAcceptance({
          id: "a3",
          returnItemId: "item-2",
          recoveryAmountCents: 300,
        }),
      ]);

      expect(deduped).toHaveLength(2);
      expect(
        deduped.find((record) => record.returnItemId === "item-1")
          ?.recoveryAmountCents,
      ).toBe(200);
    });
  });

  describe("buildOfferAcceptanceByReturnItemId", () => {
    it("builds a lookup map keyed by returnItemId", () => {
      const map = buildOfferAcceptanceByReturnItemId([
        createAcceptance({ returnItemId: "item-1" }),
        createAcceptance({ id: "a2", returnItemId: "item-2" }),
      ]);

      expect(map.get("item-1")?.acceptedOfferType).toBe("EXCHANGE");
      expect(map.get("item-2")?.acceptedOfferType).toBe("EXCHANGE");
    });
  });

  describe("normalizers", () => {
    it("normalizes offer type aliases", () => {
      expect(normalizeAcceptedOfferTypeForAnalytics("legal_review")).toBe(
        "LEGAL_REVIEW_REQUIRED",
      );
      expect(normalizeAcceptedOfferTypeForAnalytics("OFFER_EXCHANGE")).toBe(
        "EXCHANGE",
      );
    });

    it("normalizes AI sources away from analytics buckets", () => {
      expect(normalizeOfferSourceForAnalytics("AI")).toBe("SYSTEM_DEFAULT");
      expect(normalizeOfferSourceForAnalytics("CLAUDE")).toBe("SYSTEM_DEFAULT");
      expect(normalizeOfferSourceForAnalytics("CUSTOMER_SELECTED")).toBe(
        "CUSTOMER_SELECTED",
      );
    });
  });
});

describe("dashboardMapper offer acceptance", () => {
  it("includes accepted offer fields on mapped return items when acceptance is provided", () => {
    const acceptanceByReturnItemId = buildOfferAcceptanceByReturnItemId([
      createAcceptance({
        returnItemId: "return-item-1",
        acceptedOfferType: "STORE_CREDIT",
        recoveryAmountCents: 4500,
        offerSource: "RULE_ENGINE",
      }),
    ]);

    const result = mapReturnRequestToDashboard(
      {
        id: "return-1",
        status: "PENDING",
        customerEmail: "customer@example.com",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
        order: {
          orderNumber: "1001",
          items: [],
        },
        items: [
          {
            id: "return-item-1",
            orderItemId: "order-item-1",
            reason: "CHANGED_MIND",
            selectedOption: "Store Credit",
            orderItem: {
              productName: "Classic Tee",
              sku: "TEE-001",
              quantity: 1,
              price: 45,
            },
          },
        ],
      },
      { offerAcceptanceByReturnItemId: acceptanceByReturnItemId },
    );

    expect(result.selectedItems[0]).toMatchObject({
      acceptedOfferType: "STORE_CREDIT",
      acceptedOfferLabel: "Store Credit",
      estimatedRecoveredAmountCents: 4500,
      offerSource: "RULE_ENGINE",
    });
  });

  it("does not add acceptance fields when no acceptance record exists", () => {
    const result = mapReturnRequestToDashboard(
      {
        id: "return-2",
        status: "PENDING",
        customerEmail: "customer@example.com",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
        items: [
          {
            id: "return-item-2",
            orderItemId: "order-item-2",
            reason: "OTHER",
            orderItem: {
              productName: "Hat",
              sku: "HAT",
              quantity: 1,
              price: 20,
            },
          },
        ],
      },
      { offerAcceptanceByReturnItemId: new Map() },
    );

    expect(result.selectedItems[0].acceptedOfferLabel).toBeUndefined();
    expect(
      result.selectedItems[0].estimatedRecoveredAmountCents,
    ).toBeUndefined();
  });
});
