import { describe, expect, it } from "vitest";
import { mapReturnRequestToDashboard } from "@/lib/dashboardMapper";

describe("dashboardMapper order status", () => {
  it("includes Shopify order status fields on dashboard requests", () => {
    const result = mapReturnRequestToDashboard({
      id: "return-1",
      status: "PENDING",
      customerEmail: "customer@example.com",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
      order: {
        orderNumber: "1001",
        status: "FULFILLED",
        financialStatus: "paid",
        fulfillmentStatus: "fulfilled",
        cancelledAt: null,
        items: [],
      },
      items: [],
    });

    expect(result.orderStatus).toEqual({
      status: "FULFILLED",
      financialStatus: "paid",
      fulfillmentStatus: "fulfilled",
      cancelledAt: null,
    });
  });

  it("returns null order status fields when order is missing", () => {
    const result = mapReturnRequestToDashboard({
      id: "return-2",
      status: "PENDING",
      customerEmail: "customer@example.com",
      createdAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-06-01T00:00:00Z"),
      items: [],
    });

    expect(result.orderStatus).toEqual({
      status: null,
      financialStatus: null,
      fulfillmentStatus: null,
      cancelledAt: null,
    });
  });
});

describe("dashboardMapper reasonIntelligence", () => {
  it("computes reasonIntelligence for each return item from stored data", () => {
    const result = mapReturnRequestToDashboard(
      {
        id: "return-3",
        status: "PENDING",
        customerEmail: "customer@example.com",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
        order: {
          orderNumber: "1001",
          status: "FULFILLED",
          financialStatus: "paid",
          fulfillmentStatus: "fulfilled",
          cancelledAt: null,
          items: [],
        },
        items: [
          {
            id: "return-item-1",
            orderItemId: "order-item-1",
            reason: "WRONG_SIZE",
            comment: "too small",
            selectedOption: "EXCHANGE",
            recoveryScore: 92,
            riskLevel: "LOW",
            bestAction: "Exchange Product",
            orderItem: {
              id: "order-item-1",
              productName: "Classic Tee",
              sku: "TEE-001",
              quantity: 1,
              price: 29.99,
            },
          },
        ],
      },
      { storeType: "FASHION" },
    );

    expect(result.selectedItems[0].reasonIntelligence).toMatchObject({
      normalizedReason: "wrong_size",
      reasonGroup: "fit_issue",
      recommendedNextStep: "offer_exchange_first",
      merchantInsightTags: expect.any(Array),
      productContextTags: expect.any(Array),
      storeType: "fashion",
      productType: null,
      qualityIssueType: "not_quality_related",
    });
  });
});

describe("dashboardMapper offerAcceptance", () => {
  it("maps acceptance onto return items via offerAcceptanceByReturnItemId", () => {
    const acceptanceMap = new Map([
      [
        "return-item-1",
        {
          acceptedOfferType: "EXCHANGE",
          offerSource: "CUSTOMER_SELECTED",
          recoveryAmountCents: 2999,
          currency: "AUD",
          legalReviewRequired: false,
        },
      ],
    ]);

    const result = mapReturnRequestToDashboard(
      {
        id: "return-4",
        status: "PENDING",
        customerEmail: "customer@example.com",
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
        items: [
          {
            id: "return-item-1",
            orderItemId: "order-item-1",
            reason: "WRONG_SIZE",
            orderItem: {
              productName: "Classic Tee",
              sku: "TEE-001",
              quantity: 1,
              price: 29.99,
            },
          },
        ],
      },
      { offerAcceptanceByReturnItemId: acceptanceMap },
    );

    expect(result.selectedItems[0].acceptedOfferLabel).toBe("Exchange");
    expect(result.selectedItems[0].estimatedRecoveredAmountCents).toBe(2999);
  });
});
