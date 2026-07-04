import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";

const mockResolveMerchantForCustomerFlow = vi.fn();
const mockFindCustomerOrderForReturn = vi.fn();
const mockEvaluateSubmitReturnItemDecisions = vi.fn();
const mockSafeCreateAuditEvent = vi.fn();

vi.mock("@/lib/orderLookup", () => ({
  resolveMerchantForCustomerFlow: (...args) =>
    mockResolveMerchantForCustomerFlow(...args),
  findCustomerOrderForReturn: (...args) =>
    mockFindCustomerOrderForReturn(...args),
}));

vi.mock("@/lib/itemRecoveryDecisions", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
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

import { POST as submitReturnPost } from "@/app/api/submit-return/route";
import { recordOfferAcceptance } from "@/lib/offerAcceptanceTracking";

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const recoveryRules = [
  {
    id: "exchange-rule",
    type: "EXCHANGE",
    enabled: true,
    priority: 1,
    conditions: {},
    actions: {},
  },
  {
    id: "credit-rule",
    type: "STORE_CREDIT",
    enabled: true,
    priority: 2,
    conditions: {},
    actions: { bonusPercent: 10 },
  },
  {
    id: "partial-rule",
    type: "PARTIAL_REFUND",
    enabled: true,
    priority: 3,
    conditions: {},
    actions: { maxRefundPercent: 20 },
  },
];

const order = {
  id: "order-1",
  merchantId: "merchant-1",
  orderNumber: "1001",
  customerEmail: "test1@gmail.com",
  customerName: "Test User",
  currency: "AUD",
  deliveredAt: new Date().toISOString(),
  merchant: { id: "merchant-1", returnWindowDays: 30, currency: "AUD" },
  merchantSettings: { aiConfidence: 0.5 },
  recoveryRules,
  items: [
    {
      id: "item-1",
      sku: "TEE-001",
      productName: "Tee",
      price: 100,
      quantity: 1,
      isReturnable: true,
    },
    {
      id: "item-2",
      sku: "TEE-002",
      productName: "Hoodie",
      price: 50,
      quantity: 1,
      isReturnable: true,
    },
  ],
};

function buildCreatedReturnRequest(items) {
  return {
    id: "return-1",
    status: "PENDING",
    items: items.map((entry, index) => ({
      id: `return-item-${index + 1}`,
      orderItemId: entry.orderItemId,
      reason: entry.reason ?? "WRONG_SIZE",
      riskLevel: entry.riskLevel ?? "LOW",
      bestAction: entry.bestAction ?? "Exchange Product",
      merchantNote: null,
      orderItem: order.items.find((item) => item.id === entry.orderItemId),
    })),
    order,
    events: [],
  };
}

describe("submit-return offer acceptance integration", () => {
  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
    mockResolveMerchantForCustomerFlow.mockResolvedValue(null);
    mockFindCustomerOrderForReturn.mockResolvedValue(order);
    mockSafeCreateAuditEvent.mockResolvedValue(undefined);
    mockPrisma.returnItem.findMany.mockResolvedValue([]);
    mockPrisma.returnEvent.create.mockResolvedValue({ id: "event-1" });
  });

  function mockSubmitDecision(itemDecisions) {
    mockEvaluateSubmitReturnItemDecisions.mockResolvedValue({
      hasExcludedItems: false,
      itemDecisions,
      serializePolicyResult: () => ({
        decision: "EXCHANGE",
        customerMessage: "Policy message",
        confidence: "HIGH",
      }),
    });
  }

  it("records exchange submission offer acceptance", async () => {
    mockSubmitDecision([
      {
        itemId: "item-1",
        recommendedAction: "OFFER_EXCHANGE",
        productExcluded: false,
        aiOfferSuppressed: false,
        policyDecision: { decision: "EXCHANGE" },
      },
    ]);
    mockPrisma.returnRequest.create.mockResolvedValue(
      buildCreatedReturnRequest([{ orderItemId: "item-1" }]),
    );
    mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "acc-1" });

    const response = await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            returnReason: "wrong_size",
            selectedOption: "Exchange Product",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { returnItemId: "return-item-1" },
        create: expect.objectContaining({
          merchantId: "merchant-1",
          returnRequestId: "return-1",
          acceptedOfferType: "EXCHANGE",
          offerSource: "CUSTOMER_SELECTED",
          recoveryAmountCents: 10000,
          legalReviewRequired: false,
        }),
      }),
    );
  });

  it("records store credit submission offer acceptance", async () => {
    mockSubmitDecision([
      {
        itemId: "item-1",
        recommendedAction: "OFFER_STORE_CREDIT",
        productExcluded: false,
      },
    ]);
    mockPrisma.returnRequest.create.mockResolvedValue(
      buildCreatedReturnRequest([{ orderItemId: "item-1" }]),
    );
    mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "acc-1" });

    await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            returnReason: "changed_mind",
            selectedOption: "Store Credit",
          },
        ],
      }),
    );

    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 9000,
        }),
      }),
    );
  });

  it("records partial refund submission offer acceptance", async () => {
    mockSubmitDecision([
      {
        itemId: "item-1",
        recommendedAction: "OFFER_PARTIAL_REFUND",
        productExcluded: false,
      },
    ]);
    mockPrisma.returnRequest.create.mockResolvedValue(
      buildCreatedReturnRequest([{ orderItemId: "item-1" }]),
    );
    mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "acc-1" });

    await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            returnReason: "changed_mind",
            selectedOption: "Partial Refund",
          },
        ],
      }),
    );

    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acceptedOfferType: "PARTIAL_REFUND",
          recoveryAmountCents: 8000,
        }),
      }),
    );
  });

  it("records manual review with zero recovery", async () => {
    mockSubmitDecision([
      {
        itemId: "item-1",
        recommendedAction: "MANUAL_REVIEW",
        productExcluded: true,
        aiOfferSuppressed: true,
      },
    ]);
    mockPrisma.returnRequest.create.mockResolvedValue(
      buildCreatedReturnRequest([{ orderItemId: "item-1" }]),
    );
    mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "acc-1" });

    await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            returnReason: "changed_mind",
            selectedOption: "Manual Review",
          },
        ],
      }),
    );

    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acceptedOfferType: "MANUAL_REVIEW",
          recoveryAmountCents: 0,
        }),
      }),
    );
  });

  it("records LEGAL_REVIEW_REQUIRED distinctly with zero recovery", async () => {
    mockSubmitDecision([
      {
        itemId: "item-1",
        recommendedAction: "LEGAL_REVIEW_REQUIRED",
        productExcluded: true,
        dynamicOfferLadder: {
          manualReviewRequired: true,
          blockedReason: "legal_review_required",
        },
      },
    ]);
    mockPrisma.returnRequest.create.mockResolvedValue(
      buildCreatedReturnRequest([{ orderItemId: "item-1" }]),
    );
    mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "acc-1" });

    await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            returnReason: "damaged_item",
            selectedOption: "Exchange Product",
          },
        ],
      }),
    );

    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
          legalReviewRequired: true,
          recoveryAmountCents: 0,
          offerSource: "RULE_ENGINE",
        }),
      }),
    );
  });

  it("does not break submit-return when tracking fails", async () => {
    mockSubmitDecision([
      {
        itemId: "item-1",
        recommendedAction: "OFFER_EXCHANGE",
      },
    ]);
    mockPrisma.returnRequest.create.mockResolvedValue(
      buildCreatedReturnRequest([{ orderItemId: "item-1" }]),
    );
    mockPrisma.returnOfferAcceptance.upsert.mockRejectedValue(
      new Error("tracking down"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            returnReason: "wrong_size",
            selectedOption: "Exchange Product",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).success).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("creates one acceptance record per item on multi-item submit", async () => {
    mockSubmitDecision([
      { itemId: "item-1", recommendedAction: "OFFER_EXCHANGE" },
      { itemId: "item-2", recommendedAction: "OFFER_STORE_CREDIT" },
    ]);
    mockPrisma.returnRequest.create.mockResolvedValue(
      buildCreatedReturnRequest([
        { orderItemId: "item-1" },
        { orderItemId: "item-2" },
      ]),
    );
    mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "acc-x" });

    await submitReturnPost(
      jsonRequest("http://localhost/api/submit-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
        returnRequestItems: [
          {
            itemId: "item-1",
            returnReason: "wrong_size",
            selectedOption: "Exchange Product",
          },
          {
            itemId: "item-2",
            returnReason: "changed_mind",
            selectedOption: "Store Credit",
          },
        ],
      }),
    );

    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { returnItemId: "return-item-1" },
      }),
    );
    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { returnItemId: "return-item-2" },
      }),
    );
  });

  it("updates existing acceptance via upsert instead of duplicating", async () => {
    mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "acc-1" });

    await recordOfferAcceptance({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItemId: "return-item-1",
      acceptedOfferType: "EXCHANGE",
      offerSource: "CUSTOMER_SELECTED",
      item: order.items[0],
      prismaClient: mockPrisma,
    });
    await recordOfferAcceptance({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItemId: "return-item-1",
      acceptedOfferType: "STORE_CREDIT",
      offerSource: "CUSTOMER_SELECTED",
      item: order.items[0],
      storeCreditBonusCents: 1000,
      prismaClient: mockPrisma,
    });

    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { returnItemId: "return-item-1" },
        update: expect.objectContaining({
          acceptedOfferType: "STORE_CREDIT",
        }),
      }),
    );
  });
});
