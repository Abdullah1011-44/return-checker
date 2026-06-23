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
