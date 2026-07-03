import { beforeEach, describe, expect, it, vi } from "vitest";
import { OFFER_TYPES } from "@/lib/dynamicOfferLadder";
import { PRODUCT_EXCLUSION_RULE_TYPE } from "@/lib/productExclusion";
import { mockPrisma } from "./helpers/mockPrisma.js";

const mockResolveMerchantForCustomerFlow = vi.fn();
const mockFindCustomerOrderForReturn = vi.fn();
const mockEvaluateCheckReturnItemDecisions = vi.fn();
const mockEvaluateSubmitReturnItemDecisions = vi.fn();
const mockSafeCreateAuditEvent = vi.fn();

let useRealItemDecisions = false;

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
      useRealItemDecisions
        ? actual.evaluateCheckReturnItemDecisions(...args)
        : mockEvaluateCheckReturnItemDecisions(...args),
    evaluateSubmitReturnItemDecisions: (...args) =>
      useRealItemDecisions
        ? actual.evaluateSubmitReturnItemDecisions(...args)
        : mockEvaluateSubmitReturnItemDecisions(...args),
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

function buildMockDynamicOfferLadder(overrides = {}) {
  return {
    engineVersion: "dynamic_offer_ladder_v1",
    primaryOffer: {
      type: OFFER_TYPES.MANUAL_REVIEW,
      rank: 1,
      title: "Merchant review",
      customerMessage: "The store will review your request.",
      merchantReason: "Manual review required before any recovery action.",
      recoveryIntent: "human_review_required",
      requiresMerchantApproval: true,
      score: 100,
      enabled: true,
    },
    offers: [
      {
        type: OFFER_TYPES.MANUAL_REVIEW,
        rank: 1,
        title: "Merchant review",
        customerMessage: "The store will review your request.",
        merchantReason: "Manual review required before any recovery action.",
        recoveryIntent: "human_review_required",
        requiresMerchantApproval: true,
        score: 100,
        enabled: true,
      },
    ],
    manualReviewRequired: true,
    blockedReason: "product_excluded",
    auditReasons: ["exclusion:product_excluded"],
    ...overrides,
  };
}

function assertFullOfferShape(offer) {
  expect(offer).toMatchObject({
    type: expect.any(String),
    rank: expect.any(Number),
    title: expect.any(String),
    customerMessage: expect.any(String),
    merchantReason: expect.any(String),
    recoveryIntent: expect.any(String),
    requiresMerchantApproval: true,
    score: expect.any(Number),
    enabled: expect.any(Boolean),
  });
}

function assertDynamicOfferLadderShape(ladder) {
  expect(ladder).toMatchObject({
    engineVersion: expect.any(String),
    primaryOffer: expect.anything(),
    offers: expect.any(Array),
    manualReviewRequired: expect.any(Boolean),
    auditReasons: expect.any(Array),
  });

  for (const offer of ladder.offers) {
    assertFullOfferShape(offer);
  }

  if (ladder.primaryOffer) {
    expect(ladder.primaryOffer.enabled).toBe(true);
  }
}

const exclusionRule = {
  type: PRODUCT_EXCLUSION_RULE_TYPE,
  enabled: true,
  conditions: [
    {
      id: "gift-card-exclusion",
      matcherType: "tag",
      value: "gift-card",
      reason: "Product is excluded from automated return recovery",
    },
    {
      id: "final-sale-sku",
      matcherType: "sku",
      value: "FINAL-SALE-001",
      reason: "Product is excluded from automated return recovery",
    },
  ],
  actions: {},
};

const recoveryRules = [
  {
    id: "exchange-rule",
    type: "EXCHANGE",
    name: "Exchange",
    enabled: true,
    priority: 1,
    conditions: {},
    actions: {},
  },
  {
    id: "credit-rule",
    type: "STORE_CREDIT",
    name: "Store credit",
    enabled: true,
    priority: 2,
    conditions: {},
    actions: { bonusPercent: 10 },
  },
  {
    id: "partial-rule",
    type: "PARTIAL_REFUND",
    name: "Partial refund",
    enabled: true,
    priority: 3,
    conditions: {},
    actions: { maxRefundPercent: 20, requiresApproval: true },
  },
  {
    id: "manual-rule",
    type: "MANUAL_REVIEW",
    name: "Manual review",
    enabled: true,
    priority: 4,
    conditions: {},
    actions: {},
  },
  exclusionRule,
];

const merchantSettings = {
  allowExchange: true,
  allowStoreCredit: true,
  allowPartialRefund: true,
  aiConfidence: 0.5,
};

const order = {
  id: "order-1",
  merchantId: "merchant-1",
  orderNumber: "1001",
  customerEmail: "test1@gmail.com",
  customerName: "Test User",
  deliveredAt: new Date().toISOString(),
  totalAmount: 120,
  merchant: { id: "merchant-1", returnWindowDays: 30 },
  merchantSettings,
  recoveryRules,
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
    useRealItemDecisions = false;
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
          dynamicOfferLadder: buildMockDynamicOfferLadder({
            primaryOffer: {
              type: OFFER_TYPES.EXCHANGE,
              rank: 1,
              title: "Exchange",
              customerMessage: "Exchange this item.",
              merchantReason: "Exchange recommended.",
              recoveryIntent: "retain_revenue_via_exchange",
              requiresMerchantApproval: true,
              score: 100,
              enabled: true,
            },
            manualReviewRequired: false,
            blockedReason: null,
            auditReasons: ["exchange:stock_unknown"],
          }),
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
          dynamicOfferLadder: buildMockDynamicOfferLadder(),
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
    expect(body.items[0].dynamicOfferLadder).toBeDefined();
    expect(body.items[1].productExcluded).toBe(true);
    expect(body.items[1].recommendedAction).toBe("MANUAL_REVIEW");
    expect(body.items[1].customerMessage).toBe(EXCLUDED_ITEM_CUSTOMER_MESSAGE);
    expect(body.items[1].exclusionRuleId).toBe("gift-card-exclusion");
    expect(body.items[1].dynamicOfferLadder.primaryOffer.type).toBe(
      OFFER_TYPES.MANUAL_REVIEW,
    );
    expect(body.items[1].customerMessage).not.toContain("gift-card-exclusion");
    expect(body.recommendedAction).toBeUndefined();
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
          dynamicOfferLadder: buildMockDynamicOfferLadder(),
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
    expect(body.dynamicOfferLadder).toBeDefined();
    expect(body.dynamicOfferLadder.primaryOffer.type).toBe(
      OFFER_TYPES.MANUAL_REVIEW,
    );
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

describe("dynamic offer ladder API responses", () => {
  beforeEach(() => {
    useRealItemDecisions = true;
    vi.clearAllMocks();
    mockResolveMerchantForCustomerFlow.mockResolvedValue(null);
    mockPrisma.returnItem.findMany.mockResolvedValue([]);
    mockSafeCreateAuditEvent.mockResolvedValue(undefined);
    mockPrisma.returnEvent.create.mockResolvedValue({ id: "event-1" });
  });

  it("check-return returns dynamicOfferLadder for eligible item responses", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [order.items[0]],
    });

    const response = await checkReturnPost(
      jsonRequest("http://localhost/api/check-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0].dynamicOfferLadder).toBeDefined();
    expect(body.itemDecisions[0].dynamicOfferLadder).toBeDefined();
    assertDynamicOfferLadderShape(body.items[0].dynamicOfferLadder);
    expect(body.items[0].recommendedAction).toBeDefined();
    expect(body.orderEligible).toBe(true);
    expect(body.items[0].reasonIntelligence).toMatchObject({
      reasonGroup: expect.any(String),
      merchantInsightTags: expect.any(Array),
      productContextTags: expect.any(Array),
    });
  });

  it("submit-return returns dynamicOfferLadder on itemDecisions and single-item top level", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [order.items[0]],
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-3",
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
            returnReason: "wrong_size",
            selectedOption: "Exchange Product",
          },
        ],
      }),
    );
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.dynamicOfferLadder).toBeDefined();
    expect(body.itemDecisions[0].dynamicOfferLadder).toBeDefined();
    assertDynamicOfferLadderShape(body.dynamicOfferLadder);
  });

  it("wrong_size eligible item gets exchange as primaryOffer when stock is unknown", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [order.items[0]],
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-4",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-1",
          recoveryScore: 92,
          riskLevel: "LOW",
          bestAction: "Exchange Product",
          merchantNote: null,
          orderItem: order.items[0],
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
            returnReason: "wrong_size",
            selectedOption: "Exchange Product",
          },
        ],
      }),
    );
    const body = await response.json();

    expect(body.dynamicOfferLadder.primaryOffer.type).toBe(
      OFFER_TYPES.EXCHANGE,
    );
    expect(body.dynamicOfferLadder.primaryOffer.enabled).toBe(true);
    expect(body.dynamicOfferLadder.auditReasons).toContain(
      "exchange:stock_unknown",
    );
  });

  it("wrong_size eligible item gets exchange as primaryOffer when stock is available", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [{ ...order.items[0], exchangeStockAvailable: true }],
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-5",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-1",
          recoveryScore: 92,
          riskLevel: "LOW",
          bestAction: "Exchange Product",
          merchantNote: null,
          orderItem: order.items[0],
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
            returnReason: "wrong_size",
            selectedOption: "Exchange Product",
          },
        ],
      }),
    );
    const body = await response.json();

    expect(body.dynamicOfferLadder.primaryOffer.type).toBe(
      OFFER_TYPES.EXCHANGE,
    );
    expect(body.dynamicOfferLadder.primaryOffer.enabled).toBe(true);
    expect(body.itemDecisions[0].reasonIntelligence).toMatchObject({
      normalizedReason: "wrong_size",
      reasonGroup: "fit_issue",
      recommendedNextStep: "offer_exchange_first",
      merchantInsightTags: expect.any(Array),
      productContextTags: expect.any(Array),
    });
    expect(body.reasonIntelligence).toMatchObject({
      normalizedReason: "wrong_size",
      reasonGroup: "fit_issue",
    });
  });

  it("exchange is not primary when exchangeStockAvailable is false", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [{ ...order.items[0], exchangeStockAvailable: false }],
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-6",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-1",
          recoveryScore: 92,
          riskLevel: "LOW",
          bestAction: "Store Credit",
          merchantNote: null,
          orderItem: order.items[0],
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
            returnReason: "wrong_size",
            selectedOption: "Store Credit",
          },
        ],
      }),
    );
    const body = await response.json();

    expect(body.dynamicOfferLadder.primaryOffer.type).not.toBe(
      OFFER_TYPES.EXCHANGE,
    );
    expect(
      body.dynamicOfferLadder.offers.find(
        (offer) => offer.type === OFFER_TYPES.EXCHANGE,
      )?.enabled,
    ).toBe(false);
    expect(body.dynamicOfferLadder.auditReasons).toContain(
      "exchange:stock_unavailable",
    );
  });

  it("excluded item returns manual_review as primaryOffer with only manual_review enabled", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [order.items[1]],
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-7",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-2",
          recoveryScore: 70,
          riskLevel: "LOW",
          bestAction: "Manual Review",
          merchantNote: JSON.stringify({ productExcluded: true }),
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

    const enabledOffers = body.dynamicOfferLadder.offers.filter(
      (offer) => offer.enabled,
    );

    expect(body.productExcluded).toBe(true);
    expect(body.dynamicOfferLadder.primaryOffer.type).toBe(
      OFFER_TYPES.MANUAL_REVIEW,
    );
    expect(enabledOffers).toHaveLength(1);
    expect(body.dynamicOfferLadder.manualReviewRequired).toBe(true);
    expect(body.dynamicOfferLadder.blockedReason).toBeTruthy();
  });

  it("LEGAL_REVIEW_REQUIRED returns manual_review primary and policy audit reason", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [order.items[1]],
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-8",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-2",
          recoveryScore: 70,
          riskLevel: "LOW",
          bestAction: "Manual Review",
          merchantNote: JSON.stringify({ productExcluded: true }),
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
            returnReason: "damaged_item",
            selectedOption: "Manual Review",
          },
        ],
      }),
    );
    const body = await response.json();

    const enabledOffers = body.dynamicOfferLadder.offers.filter(
      (offer) => offer.enabled,
    );

    expect(body.recommendedAction).toBe("LEGAL_REVIEW_REQUIRED");
    expect(body.dynamicOfferLadder.primaryOffer.type).toBe(
      OFFER_TYPES.MANUAL_REVIEW,
    );
    expect(enabledOffers).toHaveLength(1);
    expect(body.dynamicOfferLadder.manualReviewRequired).toBe(true);
    expect(body.dynamicOfferLadder.blockedReason).toBe("legal_review_required");
    expect(body.dynamicOfferLadder.auditReasons).toContain(
      "policy:legal_review_required",
    );
  });

  it("store_credit offer includes bonus incentive from recovery rules", async () => {
    mockFindCustomerOrderForReturn.mockResolvedValue({
      ...order,
      items: [order.items[0]],
    });

    mockPrisma.returnRequest.create.mockResolvedValue({
      id: "return-9",
      status: "PENDING",
      items: [
        {
          id: "return-item-1",
          orderItemId: "item-1",
          recoveryScore: 92,
          riskLevel: "LOW",
          bestAction: "Store Credit",
          merchantNote: null,
          orderItem: order.items[0],
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
            selectedOption: "Store Credit",
          },
        ],
      }),
    );
    const body = await response.json();

    const storeCredit = body.dynamicOfferLadder.offers.find(
      (offer) => offer.type === OFFER_TYPES.STORE_CREDIT,
    );

    expect(body.dynamicOfferLadder.primaryOffer.type).toBe(
      OFFER_TYPES.STORE_CREDIT,
    );
    expect(storeCredit?.incentive).toEqual({
      type: "bonus_credit",
      percent: 10,
    });
    expect(storeCredit?.customerMessage.toLowerCase()).toContain("bonus");
  });
});
