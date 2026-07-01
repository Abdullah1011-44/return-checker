import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "./helpers/mockPrisma.js";

const mockResolveMerchantForCustomerFlow = vi.fn();
const mockFindCustomerOrderForReturn = vi.fn();
const mockEvaluateCheckReturnItemDecisions = vi.fn();
const mockEvaluateSubmitReturnItemDecisions = vi.fn();
const mockSafeCreateAuditEvent = vi.fn();

vi.mock("@/lib/orderLookup", () => ({
  resolveMerchantForCustomerFlow: (...args) =>
    mockResolveMerchantForCustomerFlow(...args),
  findCustomerOrderForReturn: (...args) =>
    mockFindCustomerOrderForReturn(...args),
  buildOrderCheckApiResponse: vi.fn(async (order) => ({
    success: true,
    orderFound: true,
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail,
    orderEligible: true,
    items: (order.items ?? []).map((item) => ({
      id: item.id,
      title: item.productName,
      sku: item.sku,
      eligible: true,
      ineligibleReason: "",
    })),
  })),
  orderNotFoundMessage: vi.fn(() => "Order not found."),
}));

vi.mock("@/lib/itemRecoveryDecisions", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    evaluateCheckReturnItemDecisions: (...args) =>
      mockEvaluateCheckReturnItemDecisions(...args),
    evaluateSubmitReturnItemDecisions: (...args) =>
      mockEvaluateSubmitReturnItemDecisions(...args),
  };
});

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTORS: { CUSTOMER: "CUSTOMER" },
  AUDIT_EVENTS: { RETURN_SUBMITTED: "RETURN_SUBMITTED" },
  safeCreateAuditEvent: (...args) => mockSafeCreateAuditEvent(...args),
}));

vi.mock("@/lib/sentry", () => ({
  captureException: vi.fn(),
}));

import { POST as checkReturnPost } from "@/app/api/check-return/route";
import { POST as submitReturnPost } from "@/app/api/submit-return/route";
import { EXCLUDED_ITEM_CUSTOMER_MESSAGE } from "@/lib/itemRecoveryDecisions";

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const order = {
  id: "order-1",
  merchantId: "merchant-1",
  orderNumber: "1001",
  customerEmail: "test1@gmail.com",
  customerName: "Test User",
  deliveredAt: new Date().toISOString(),
  totalAmount: 120,
  merchant: { id: "merchant-1", returnWindowDays: 30 },
  items: [
    {
      id: "item-1",
      sku: "TEE-001",
      productName: "Tee",
      isReturnable: true,
      price: 29.99,
    },
    {
      id: "item-2",
      sku: "FINAL-SALE-001",
      productName: "Final Sale Tee",
      isReturnable: true,
      price: 19.99,
    },
  ],
};

describe("return exclusion API integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveMerchantForCustomerFlow.mockResolvedValue(null);
    mockPrisma.returnItem.findMany.mockResolvedValue([]);
    mockSafeCreateAuditEvent.mockResolvedValue(undefined);
    mockPrisma.returnEvent.create.mockResolvedValue({ id: "event-1" });
  });

  it("includes excluded item decisions in check-return response", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue(order);
    mockEvaluateCheckReturnItemDecisions.mockResolvedValue({
      hasExcludedItems: true,
      itemDecisions: [
        {
          itemId: "item-1",
          productExcluded: false,
          recommendedAction: "OFFER_EXCHANGE",
          recoveryOffers: [],
          aiOfferSuppressed: false,
          policyDecision: { decision: "EXCHANGE" },
        },
        {
          itemId: "item-2",
          productExcluded: true,
          recommendedAction: "MANUAL_REVIEW",
          recoveryOffers: [],
          aiOfferSuppressed: true,
          customerMessage: EXCLUDED_ITEM_CUSTOMER_MESSAGE,
          exclusionReason: "Product is excluded from automated return recovery",
          exclusionRuleId: "gift-card-exclusion",
          matchedField: "tag",
          matchedValue: "gift-card",
          policyDecision: { decision: "MANUAL_REVIEW" },
        },
      ],
      serializePolicyResult: () => ({
        decision: "EXCHANGE",
        customerMessage: "Policy message",
        recommendedAction: "Exchange Product",
        allowedOptions: ["Exchange Product"],
        confidence: "HIGH",
      }),
    });

    const response = await checkReturnPost(
      jsonRequest("http://localhost/api/check-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hasExcludedItems).toBe(true);
    expect(body.itemDecisions).toHaveLength(2);
    expect(body.items[1].productExcluded).toBe(true);
    expect(body.items[1].recommendedAction).toBe("MANUAL_REVIEW");
    expect(body.items[1].customerMessage).toBe(EXCLUDED_ITEM_CUSTOMER_MESSAGE);
    expect(body.items[1].exclusionRuleId).toBe("gift-card-exclusion");
    expect(body.items[1].customerMessage).not.toContain("gift-card-exclusion");
  });

  it("preserves single-item top-level submit-return shape for excluded items", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [order.items[1]],
    });
    mockEvaluateSubmitReturnItemDecisions.mockResolvedValue({
      hasExcludedItems: true,
      policyResult: {
        decision: "MANUAL_REVIEW",
        customerMessage: EXCLUDED_ITEM_CUSTOMER_MESSAGE,
        confidence: "LOW",
      },
      itemDecisions: [
        {
          itemId: "item-2",
          productExcluded: true,
          recommendedAction: "MANUAL_REVIEW",
          recoveryOffers: [],
          aiOfferSuppressed: true,
          customerMessage: EXCLUDED_ITEM_CUSTOMER_MESSAGE,
          exclusionReason: "Product is excluded from automated return recovery",
          exclusionRuleId: "gift-card-exclusion",
          matchedField: "tag",
          matchedValue: "gift-card",
          policyDecision: { decision: "MANUAL_REVIEW" },
        },
      ],
      serializePolicyResult: () => ({
        decision: "MANUAL_REVIEW",
        customerMessage: EXCLUDED_ITEM_CUSTOMER_MESSAGE,
        recommendedAction: "Manual Review",
        allowedOptions: ["Manual Review"],
        confidence: "LOW",
      }),
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-1",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-2",
          recoveryScore: 70,
          riskLevel: "LOW",
          bestAction: "Manual Review",
          merchantNote: JSON.stringify({
            productExcluded: true,
            recommendedAction: "MANUAL_REVIEW",
            exclusionRuleId: "gift-card-exclusion",
            aiOfferSuppressed: true,
          }),
          orderItem: order.items[1],
        },
      ],
      order,
      events: [],
    });

    const response = await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-2",
            sku: "FINAL-SALE-001",
            returnReason: "changed_mind",
            selectedOption: "Manual Review",
          },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.productExcluded).toBe(true);
    expect(body.recommendedAction).toBe("MANUAL_REVIEW");
    expect(body.aiOfferSuppressed).toBe(true);
    expect(body.customerMessage).toBe(EXCLUDED_ITEM_CUSTOMER_MESSAGE);
    expect(body.exclusionReason).toBe(
      "Product is excluded from automated return recovery",
    );
    expect(body.itemDecisions).toHaveLength(1);
    expect(body.returnRequest.items[0].merchantNote).toContain(
      "gift-card-exclusion",
    );
    expect(body.customerMessage).not.toContain("gift-card-exclusion");
  });

  it("returns mixed multi-item submit decisions without blocking normal items", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue(order);
    mockEvaluateSubmitReturnItemDecisions.mockResolvedValue({
      hasExcludedItems: true,
      policyResult: {
        decision: "EXCHANGE",
        customerMessage: "Exchange recommended",
        confidence: "HIGH",
      },
      itemDecisions: [
        {
          itemId: "item-1",
          productExcluded: false,
          recommendedAction: "OFFER_EXCHANGE",
          recoveryOffers: [{ type: "EXCHANGE" }],
          aiOfferSuppressed: false,
          policyDecision: { decision: "EXCHANGE" },
        },
        {
          itemId: "item-2",
          productExcluded: true,
          recommendedAction: "LEGAL_REVIEW_REQUIRED",
          recoveryOffers: [],
          aiOfferSuppressed: true,
          customerMessage: EXCLUDED_ITEM_CUSTOMER_MESSAGE,
          exclusionReason: "Product is excluded from automated return recovery",
          policyDecision: { decision: "MANUAL_REVIEW" },
        },
      ],
      serializePolicyResult: () => ({
        decision: "EXCHANGE",
        customerMessage: "Exchange recommended",
        recommendedAction: "Exchange Product",
        allowedOptions: ["Exchange Product"],
        confidence: "HIGH",
      }),
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-2",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-1",
          recoveryScore: 92,
          riskLevel: "LOW",
          bestAction: "Exchange Product",
          merchantNote: null,
          orderItem: { ...order.items[0], price: 29.99 },
        },
        {
          id: "return-item-2",
          orderItemId: "item-2",
          recoveryScore: 70,
          riskLevel: "LOW",
          bestAction: "Manual Review",
          merchantNote: JSON.stringify({ productExcluded: true }),
          orderItem: { ...order.items[1], price: 19.99 },
        },
      ],
      order,
      events: [],
    });

    const response = await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            sku: "TEE-001",
            returnReason: "changed_mind",
            selectedOption: "Exchange Product",
          },
          {
            itemId: "item-2",
            sku: "FINAL-SALE-001",
            returnReason: "damaged_item",
            selectedOption: "Manual Review",
          },
        ],
      }),
    );
    const body = await response.json();

    expect(body.hasExcludedItems).toBe(true);
    expect(body.itemDecisions[0].recommendedAction).toBe("OFFER_EXCHANGE");
    expect(body.itemDecisions[1].recommendedAction).toBe(
      "LEGAL_REVIEW_REQUIRED",
    );
    expect(body.itemDecisions[1].customerMessage).toBe(
      EXCLUDED_ITEM_CUSTOMER_MESSAGE,
    );
    expect(body.productExcluded).toBeUndefined();
  });
});
