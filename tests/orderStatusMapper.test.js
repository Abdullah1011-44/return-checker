import { describe, expect, it } from "vitest";
import {
  buildOrderStatusFields,
  getOrderStatusFieldUpdates,
  mapShopifyOrderStatus,
} from "@/lib/orderStatusMapper";

describe("orderStatusMapper", () => {
  it("maps cancelled orders to CANCELLED", () => {
    expect(
      mapShopifyOrderStatus({
        cancelled_at: "2026-01-01T00:00:00Z",
        fulfillment_status: "fulfilled",
        financial_status: "paid",
      }),
    ).toBe("CANCELLED");
  });

  it("maps fulfilled orders to FULFILLED", () => {
    expect(
      mapShopifyOrderStatus({
        fulfillment_status: "fulfilled",
        financial_status: "paid",
      }),
    ).toBe("FULFILLED");
  });

  it("maps paid orders to PAID", () => {
    expect(
      mapShopifyOrderStatus({
        fulfillment_status: null,
        financial_status: "paid",
      }),
    ).toBe("PAID");
  });

  it("defaults other orders to PENDING", () => {
    expect(
      mapShopifyOrderStatus({
        fulfillment_status: "partial",
        financial_status: "pending",
      }),
    ).toBe("PENDING");
  });

  it("returns null patch when status fields are unchanged", () => {
    const existing = {
      status: "PAID",
      financialStatus: "paid",
      fulfillmentStatus: null,
      cancelledAt: null,
    };

    expect(
      getOrderStatusFieldUpdates(existing, {
        financial_status: "paid",
        fulfillment_status: null,
      }),
    ).toBeNull();
  });

  it("returns only changed status fields", () => {
    const existing = {
      status: "PENDING",
      financialStatus: "pending",
      fulfillmentStatus: null,
      cancelledAt: null,
    };

    expect(
      getOrderStatusFieldUpdates(existing, {
        financial_status: "paid",
        fulfillment_status: null,
      }),
    ).toEqual({
      status: "PAID",
      financialStatus: "paid",
    });
  });

  it("builds all status fields from Shopify payload", () => {
    expect(
      buildOrderStatusFields({
        financial_status: "paid",
        fulfillment_status: "fulfilled",
        cancelled_at: null,
      }),
    ).toEqual({
      status: "FULFILLED",
      financialStatus: "paid",
      fulfillmentStatus: "fulfilled",
      cancelledAt: null,
    });
  });
});
