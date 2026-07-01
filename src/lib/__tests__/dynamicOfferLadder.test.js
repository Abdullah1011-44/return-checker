import { describe, expect, it } from "vitest";
import {
  buildDynamicOfferLadder,
  normalizeMerchantOfferRules,
  OFFER_LADDER_ENGINE_VERSION,
  OFFER_TYPES,
} from "@/lib/dynamicOfferLadder";
import { DEFAULT_MERCHANT_RECOVERY_RULES } from "@/lib/merchantRecoveryRules";

const ENABLED_MERCHANT_RULES = {
  exchangeEnabled: true,
  storeCreditEnabled: true,
  partialRefundEnabled: true,
  manualReviewEnabled: true,
  maxPartialRefundPercent: 20,
  storeCreditBonusPercent: 0,
};

function buildInput(overrides = {}) {
  return {
    item: { id: "item-1", sku: "TEE-001" },
    order: { id: "order-1" },
    merchantRules: ENABLED_MERCHANT_RULES,
    context: { exchangeStockAvailable: true },
    ...overrides,
  };
}

function offerTypesInOrder(result) {
  return result.offers.map((offer) => offer.type);
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

describe("dynamicOfferLadder", () => {
  it("wrong_size prioritizes exchange when stock is available", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "wrong_size" }),
    );

    expect(result.primaryOffer?.type).toBe(OFFER_TYPES.EXCHANGE);
    expect(result.primaryOffer?.enabled).toBe(true);
    expect(result.offers[0].type).toBe(OFFER_TYPES.EXCHANGE);
  });

  it("wrong_size does not make exchange primary when exchangeStockAvailable is false", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "wrong_size",
        context: { exchangeStockAvailable: false },
      }),
    );

    const exchange = result.offers.find(
      (offer) => offer.type === OFFER_TYPES.EXCHANGE,
    );

    expect(exchange?.enabled).toBe(false);
    expect(exchange?.score).toBe(0);
    expect(result.primaryOffer?.type).not.toBe(OFFER_TYPES.EXCHANGE);
    expect(result.auditReasons).toContain("exchange:stock_unavailable");
  });

  it("changed_mind prioritizes store_credit", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "changed_mind" }),
    );

    expect(result.primaryOffer?.type).toBe(OFFER_TYPES.STORE_CREDIT);
    expect(result.offers[0].type).toBe(OFFER_TYPES.STORE_CREDIT);
  });

  it("changed_mind includes store credit bonus incentive and message when storeCreditBonusPercent is set", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "changed_mind",
        merchantRules: {
          ...ENABLED_MERCHANT_RULES,
          storeCreditBonusPercent: 10,
        },
      }),
    );

    const storeCredit = result.offers.find(
      (offer) => offer.type === OFFER_TYPES.STORE_CREDIT,
    );

    expect(storeCredit?.incentive).toEqual({
      type: "bonus_credit",
      percent: 10,
    });
    expect(storeCredit?.customerMessage).toContain("10%");
    expect(storeCredit?.customerMessage.toLowerCase()).toContain("bonus");
  });

  it("late_delivery prioritizes partial_refund", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "late_delivery" }),
    );

    expect(result.primaryOffer?.type).toBe(OFFER_TYPES.PARTIAL_REFUND);
    expect(result.offers[0].type).toBe(OFFER_TYPES.PARTIAL_REFUND);
  });

  it("damaged_item prioritizes manual_review and uses trust-preserving customerMessage", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "damaged_item" }),
    );

    const manualReview = result.offers.find(
      (offer) => offer.type === OFFER_TYPES.MANUAL_REVIEW,
    );

    expect(result.primaryOffer?.type).toBe(OFFER_TYPES.MANUAL_REVIEW);
    expect(manualReview?.customerMessage).toContain(
      "We're sorry this item arrived with an issue",
    );
    expect(manualReview?.customerMessage).toContain("review the details");
  });

  it("damaged_item order is manual_review, exchange, store_credit, partial_refund when not legally blocked", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "damaged_item" }),
    );

    const enabledTypes = result.offers
      .filter((offer) => offer.enabled)
      .map((offer) => offer.type);

    expect(enabledTypes).toEqual([
      OFFER_TYPES.MANUAL_REVIEW,
      OFFER_TYPES.EXCHANGE,
      OFFER_TYPES.STORE_CREDIT,
      OFFER_TYPES.PARTIAL_REFUND,
    ]);
  });

  it("policyDecision.status LEGAL_REVIEW_REQUIRED returns manual_review as only enabled offer", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "damaged_item",
        policyDecision: { status: "LEGAL_REVIEW_REQUIRED" },
      }),
    );

    const enabledOffers = result.offers.filter((offer) => offer.enabled);

    expect(enabledOffers).toHaveLength(1);
    expect(enabledOffers[0].type).toBe(OFFER_TYPES.MANUAL_REVIEW);
    expect(result.primaryOffer?.type).toBe(OFFER_TYPES.MANUAL_REVIEW);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.blockedReason).toBe("legal_review_required");
    expect(result.auditReasons).toContain("policy:legal_review_required");
  });

  it("excluded product returns only manual_review enabled", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "changed_mind",
        exclusionDecision: { productExcluded: true },
      }),
    );

    const enabledOffers = result.offers.filter((offer) => offer.enabled);

    expect(enabledOffers).toHaveLength(1);
    expect(enabledOffers[0].type).toBe(OFFER_TYPES.MANUAL_REVIEW);
    expect(enabledOffers[0].customerMessage).toContain(
      "special return conditions",
    );
    expect(result.manualReviewRequired).toBe(true);
    expect(
      result.auditReasons.some((reason) => reason.startsWith("exclusion:")),
    ).toBe(true);
  });

  it("ineligible policy returns only manual_review enabled", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "changed_mind",
        policyDecision: { status: "INELIGIBLE", eligible: false },
      }),
    );

    const enabledOffers = result.offers.filter((offer) => offer.enabled);

    expect(enabledOffers).toHaveLength(1);
    expect(enabledOffers[0].type).toBe(OFFER_TYPES.MANUAL_REVIEW);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.blockedReason).toBe("ineligible");
    expect(result.auditReasons).toContain("policy:ineligible");
  });

  it("merchant-disabled exchange is disabled and not primary", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "wrong_size",
        merchantRules: {
          ...ENABLED_MERCHANT_RULES,
          exchangeEnabled: false,
        },
      }),
    );

    const exchange = result.offers.find(
      (offer) => offer.type === OFFER_TYPES.EXCHANGE,
    );

    expect(exchange?.enabled).toBe(false);
    expect(exchange?.score).toBe(0);
    expect(result.primaryOffer?.type).not.toBe(OFFER_TYPES.EXCHANGE);
    expect(result.auditReasons).toContain("merchant:exchange_disabled");
  });

  it("maxPartialRefundPercent <= 0 disables partial_refund", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "late_delivery",
        merchantRules: {
          ...ENABLED_MERCHANT_RULES,
          maxPartialRefundPercent: 0,
        },
      }),
    );

    const partialRefund = result.offers.find(
      (offer) => offer.type === OFFER_TYPES.PARTIAL_REFUND,
    );

    expect(partialRefund?.enabled).toBe(false);
    expect(partialRefund?.score).toBe(0);
    expect(result.auditReasons).toContain(
      "merchant:max_partial_refund_percent_zero",
    );
  });

  it("missing input does not throw", () => {
    expect(() => buildDynamicOfferLadder()).not.toThrow();
    expect(() => buildDynamicOfferLadder(null)).not.toThrow();

    const result = buildDynamicOfferLadder();

    expect(result.engineVersion).toBe(OFFER_LADDER_ENGINE_VERSION);
    expect(result.offers).toHaveLength(4);
    expect(result.primaryOffer).not.toBeNull();
  });

  it("recoveryDecision manual review requirement forces manual_review primary", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "changed_mind",
        recoveryDecision: { manualReviewRequired: true },
      }),
    );

    expect(result.primaryOffer?.type).toBe(OFFER_TYPES.MANUAL_REVIEW);
    expect(result.manualReviewRequired).toBe(true);
    expect(result.auditReasons).toContain("recovery:manual_review_required");
  });

  it("all offers include full object fields", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "wrong_size" }),
    );

    for (const offer of result.offers) {
      assertFullOfferShape(offer);
    }
  });

  it("normalizeMerchantOfferRules maps RecoveryRule-like inputs defensively", () => {
    const mapped = normalizeMerchantOfferRules(DEFAULT_MERCHANT_RECOVERY_RULES);

    expect(mapped.exchangeEnabled).toBe(true);
    expect(mapped.storeCreditEnabled).toBe(true);
    expect(mapped.partialRefundEnabled).toBe(false);
    expect(mapped.manualReviewEnabled).toBe(true);
    expect(mapped.maxPartialRefundPercent).toBe(20);
    expect(mapped.storeCreditBonusPercent).toBe(0);
  });

  it("normalizeMerchantOfferRules returns safe defaults for missing input", () => {
    expect(normalizeMerchantOfferRules(null)).toEqual({
      exchangeEnabled: true,
      storeCreditEnabled: true,
      partialRefundEnabled: false,
      manualReviewEnabled: true,
      maxPartialRefundPercent: 0,
      storeCreditBonusPercent: 0,
    });
  });

  it("disabled offers have score 0", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "wrong_size",
        merchantRules: {
          ...ENABLED_MERCHANT_RULES,
          exchangeEnabled: false,
        },
      }),
    );

    for (const offer of result.offers.filter((entry) => !entry.enabled)) {
      expect(offer.score).toBe(0);
    }
  });

  it("primaryOffer is always enabled", () => {
    const scenarios = [
      buildInput({ customerReason: "wrong_size" }),
      buildInput({
        customerReason: "wrong_size",
        context: { exchangeStockAvailable: false },
      }),
      buildInput({
        customerReason: "changed_mind",
        policyDecision: { status: "INELIGIBLE" },
      }),
      buildInput({
        customerReason: "damaged_item",
        exclusionDecision: { productExcluded: true },
      }),
    ];

    for (const input of scenarios) {
      const result = buildDynamicOfferLadder(input);
      expect(result.primaryOffer).not.toBeNull();
      expect(result.primaryOffer?.enabled).toBe(true);
    }
  });

  it("unknown reason defaults to store_credit first", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "something_unusual" }),
    );

    expect(result.primaryOffer?.type).toBe(OFFER_TYPES.STORE_CREDIT);
    expect(offerTypesInOrder(result)).toContain(OFFER_TYPES.EXCHANGE);
  });

  it("records exchange:stock_unknown when stock is undefined and exchange is present", () => {
    const result = buildDynamicOfferLadder(
      buildInput({
        customerReason: "wrong_size",
        context: {},
      }),
    );

    expect(result.auditReasons).toContain("exchange:stock_unknown");
  });

  it("enabled offer scores follow 100 - ((rank - 1) * 10)", () => {
    const result = buildDynamicOfferLadder(
      buildInput({ customerReason: "wrong_size" }),
    );

    for (const offer of result.offers.filter((entry) => entry.enabled)) {
      expect(offer.score).toBe(100 - (offer.rank - 1) * 10);
    }
  });
});
