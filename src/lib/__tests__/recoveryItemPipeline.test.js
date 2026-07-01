import { describe, expect, it, vi } from "vitest";
import { OFFER_TYPES } from "@/lib/dynamicOfferLadder";
import { PRODUCT_EXCLUSION_RULE_TYPE } from "@/lib/productExclusion";
import { evaluateItemRecoveryPipeline } from "@/lib/recoveryItemPipeline";
import { POLICY_DECISIONS, POLICY_REASONS } from "@/lib/returnPolicyEngine";

const ladderRules = [
  {
    id: "exchange-rule",
    type: "EXCHANGE",
    enabled: true,
    priority: 1,
    conditions: {},
  },
  {
    id: "credit-rule",
    type: "STORE_CREDIT",
    enabled: true,
    priority: 2,
    conditions: {},
    actions: { bonusPercent: 0 },
  },
  {
    id: "partial-rule",
    type: "PARTIAL_REFUND",
    enabled: true,
    priority: 3,
    conditions: {},
    actions: { maxRefundPercent: 20, requiresApproval: true },
  },
  {
    id: "manual-rule",
    type: "MANUAL_REVIEW",
    enabled: true,
    priority: 4,
    conditions: {},
  },
];

const exclusionRule = {
  type: PRODUCT_EXCLUSION_RULE_TYPE,
  enabled: true,
  conditions: [
    {
      id: "final-sale-sku",
      matcherType: "sku",
      value: "FINAL-SALE-001",
      reason: "Final sale SKU",
    },
  ],
  actions: {},
};

const merchantSettings = {
  allowExchanges: true,
  allowStoreCredit: true,
  allowPartialRefunds: true,
  allowManualReviewFallback: true,
};

describe("recoveryItemPipeline", () => {
  it("invokes generateOfferLadder for non-excluded items", () => {
    const generateOfferLadderFn = vi.fn(() => ({
      offers: [
        {
          decision: POLICY_DECISIONS.EXCHANGE,
          ruleId: "exchange-rule",
          ruleName: "Exchange",
          ruleType: "EXCHANGE",
          unsafe: false,
        },
      ],
      primaryOffer: {
        decision: POLICY_DECISIONS.EXCHANGE,
        ruleId: "exchange-rule",
        ruleName: "Exchange",
        ruleType: "EXCHANGE",
        unsafe: false,
      },
    }));

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "CHANGED_MIND",
      customerReason: "changed_mind",
      merchantSettings: { allowExchanges: true, allowStoreCredit: true },
      recoveryRules: ladderRules,
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
      generateOfferLadderFn,
    });

    expect(generateOfferLadderFn).toHaveBeenCalledOnce();
    expect(result.generateOfferLadderInvoked).toBe(true);
    expect(result.decision).toBe(POLICY_DECISIONS.EXCHANGE);
    expect(result.aiPersuasionEnabled).toBe(true);
    expect(result.dynamicOfferLadder).toBeDefined();
  });

  it("includes dynamicOfferLadder on every evaluated item result", () => {
    const paths = [
      {
        itemContext: { sku: "TEE-001" },
        returnReason: "WRONG_SIZE",
        customerReason: "wrong_size",
        recoveryRules: ladderRules,
        recoveryScore: 92,
        aiConfidenceThreshold: 0.7,
      },
      {
        itemContext: { sku: "FINAL-SALE-001" },
        returnReason: "CHANGED_MIND",
        customerReason: "changed_mind",
        recoveryRules: [exclusionRule],
      },
      {
        itemContext: { sku: "FINAL-SALE-001" },
        returnReason: "DAMAGED_ITEM",
        customerReason: "damaged_item",
        recoveryRules: [exclusionRule],
      },
    ];

    for (const input of paths) {
      const result = evaluateItemRecoveryPipeline({
        merchantSettings,
        ...input,
      });

      expect(result.dynamicOfferLadder).toMatchObject({
        engineVersion: expect.any(String),
        primaryOffer: expect.anything(),
        offers: expect.any(Array),
        manualReviewRequired: expect.any(Boolean),
        auditReasons: expect.any(Array),
      });
    }
  });

  it("wrong_size item gets exchange as primaryOffer when stock is available", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "WRONG_SIZE",
      customerReason: "wrong_size",
      merchantSettings,
      recoveryRules: ladderRules,
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
      ladderContext: { exchangeStockAvailable: true },
    });

    expect(result.dynamicOfferLadder.primaryOffer?.type).toBe(
      OFFER_TYPES.EXCHANGE,
    );
    expect(result.dynamicOfferLadder.primaryOffer?.enabled).toBe(true);
  });

  it("wrong_size item gets exchange as primaryOffer when stock is unknown", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "WRONG_SIZE",
      customerReason: "wrong_size",
      merchantSettings,
      recoveryRules: ladderRules,
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
    });

    expect(result.dynamicOfferLadder.primaryOffer?.type).toBe(
      OFFER_TYPES.EXCHANGE,
    );
    expect(result.dynamicOfferLadder.auditReasons).toContain(
      "exchange:stock_unknown",
    );
  });

  it("wrong_size item does not get exchange as primaryOffer when exchangeStockAvailable is false", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "WRONG_SIZE",
      customerReason: "wrong_size",
      merchantSettings,
      recoveryRules: ladderRules,
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
      ladderContext: { exchangeStockAvailable: false },
    });

    expect(result.dynamicOfferLadder.primaryOffer?.type).not.toBe(
      OFFER_TYPES.EXCHANGE,
    );
    expect(
      result.dynamicOfferLadder.offers.find(
        (offer) => offer.type === OFFER_TYPES.EXCHANGE,
      )?.enabled,
    ).toBe(false);
    expect(result.dynamicOfferLadder.auditReasons).toContain(
      "exchange:stock_unavailable",
    );
  });

  it("excluded item gets manual_review as the only enabled offer", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "CHANGED_MIND",
      customerReason: "changed_mind",
      recoveryRules: [...ladderRules, exclusionRule],
    });

    const enabledOffers = result.dynamicOfferLadder.offers.filter(
      (offer) => offer.enabled,
    );

    expect(enabledOffers).toHaveLength(1);
    expect(enabledOffers[0].type).toBe(OFFER_TYPES.MANUAL_REVIEW);
    expect(result.dynamicOfferLadder.manualReviewRequired).toBe(true);
    expect(
      result.dynamicOfferLadder.auditReasons.some((reason) =>
        reason.startsWith("exclusion:"),
      ),
    ).toBe(true);
  });

  it("policyDecision.status LEGAL_REVIEW_REQUIRED results in manual_review primary and audit reason", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "DAMAGED_ITEM",
      customerReason: "damaged_item",
      merchantSettings,
      recoveryRules: ladderRules,
      policyDecision: { status: "LEGAL_REVIEW_REQUIRED" },
    });

    const enabledOffers = result.dynamicOfferLadder.offers.filter(
      (offer) => offer.enabled,
    );

    expect(enabledOffers).toHaveLength(1);
    expect(result.dynamicOfferLadder.primaryOffer?.type).toBe(
      OFFER_TYPES.MANUAL_REVIEW,
    );
    expect(result.dynamicOfferLadder.blockedReason).toBe(
      "legal_review_required",
    );
    expect(result.dynamicOfferLadder.auditReasons).toContain(
      "policy:legal_review_required",
    );
  });

  it("excluded legal item passes LEGAL_REVIEW_REQUIRED status to dynamicOfferLadder", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "DAMAGED_ITEM",
      customerReason: "damaged_item",
      recoveryRules: [exclusionRule],
    });

    expect(result.reason).toBe(POLICY_REASONS.LEGAL_REVIEW_REQUIRED);
    expect(result.dynamicOfferLadder.primaryOffer?.type).toBe(
      OFFER_TYPES.MANUAL_REVIEW,
    );
    expect(result.dynamicOfferLadder.blockedReason).toBe(
      "legal_review_required",
    );
    expect(result.dynamicOfferLadder.auditReasons).toContain(
      "policy:legal_review_required",
    );
  });

  it("recoveryDecision manual review requirement forces manual_review primary", () => {
    const generateOfferLadderFn = vi.fn(() => ({
      offers: [
        {
          decision: POLICY_DECISIONS.EXCHANGE,
          ruleId: "exchange-rule",
          ruleName: "Exchange",
          ruleType: "EXCHANGE",
          unsafe: false,
        },
      ],
      primaryOffer: {
        decision: POLICY_DECISIONS.EXCHANGE,
        ruleId: "exchange-rule",
        ruleName: "Exchange",
        ruleType: "EXCHANGE",
        unsafe: false,
      },
    }));

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "CHANGED_MIND",
      customerReason: "changed_mind",
      merchantSettings,
      recoveryRules: ladderRules,
      recoveryScore: 40,
      aiConfidenceThreshold: 0.7,
      generateOfferLadderFn,
    });

    expect(result.dynamicOfferLadder.primaryOffer?.type).toBe(
      OFFER_TYPES.MANUAL_REVIEW,
    );
    expect(result.dynamicOfferLadder.manualReviewRequired).toBe(true);
    expect(result.dynamicOfferLadder.auditReasons).toContain(
      "recovery:manual_review_required",
    );
  });

  it("merchant-disabled exchange is disabled and not primary in dynamicOfferLadder", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "WRONG_SIZE",
      customerReason: "wrong_size",
      merchantSettings,
      merchantRules: { exchangeEnabled: false },
      recoveryRules: ladderRules,
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
      ladderContext: { exchangeStockAvailable: true },
    });

    const exchange = result.dynamicOfferLadder.offers.find(
      (offer) => offer.type === OFFER_TYPES.EXCHANGE,
    );

    expect(exchange?.enabled).toBe(false);
    expect(result.dynamicOfferLadder.primaryOffer?.type).not.toBe(
      OFFER_TYPES.EXCHANGE,
    );
    expect(result.dynamicOfferLadder.auditReasons).toContain(
      "merchant:exchange_disabled",
    );
  });

  it("RecoveryRule-like inputs are normalized and affect the ladder", () => {
    const disabledExchangeRules = ladderRules.map((rule) =>
      rule.type === "EXCHANGE" ? { ...rule, enabled: false } : rule,
    );

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "WRONG_SIZE",
      customerReason: "wrong_size",
      merchantSettings: {
        allowStoreCredit: true,
        allowPartialRefunds: true,
      },
      recoveryRules: disabledExchangeRules,
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
      ladderContext: { exchangeStockAvailable: true },
    });

    const exchange = result.dynamicOfferLadder.offers.find(
      (offer) => offer.type === OFFER_TYPES.EXCHANGE,
    );

    expect(exchange?.enabled).toBe(false);
    expect(result.dynamicOfferLadder.auditReasons).toContain(
      "merchant:exchange_disabled",
    );
  });

  it("flat merchantRules are passed into the ladder", () => {
    const buildDynamicOfferLadderFn = vi.fn((input) => ({
      engineVersion: "dynamic_offer_ladder_v1",
      primaryOffer: null,
      offers: [],
      manualReviewRequired: false,
      blockedReason: null,
      auditReasons: [],
      receivedMerchantRules: input.merchantRules,
    }));

    evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "WRONG_SIZE",
      customerReason: "wrong_size",
      merchantSettings: { allowExchanges: false, allowStoreCredit: true },
      merchantRules: { storeCreditBonusPercent: 5 },
      recoveryRules: ladderRules,
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
      buildDynamicOfferLadderFn,
    });

    expect(buildDynamicOfferLadderFn).toHaveBeenCalledOnce();
    expect(
      buildDynamicOfferLadderFn.mock.calls[0][0].merchantRules,
    ).toMatchObject({
      exchangeEnabled: false,
      storeCreditBonusPercent: 5,
    });
  });

  it("does not invoke generateOfferLadder for excluded items", () => {
    const generateOfferLadderFn = vi.fn();

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "CHANGED_MIND",
      customerReason: "changed_mind",
      recoveryRules: [...ladderRules, exclusionRule],
      recoveryScore: 92,
      aiConfidenceThreshold: 0.7,
      generateOfferLadderFn,
    });

    expect(generateOfferLadderFn).not.toHaveBeenCalled();
    expect(result.generateOfferLadderInvoked).toBe(false);
    expect(result.recoveryOffers).toEqual([]);
    expect(result.aiConfidenceBypassed).toBe(true);
    expect(result.aiPersuasionEnabled).toBe(false);
    expect(result.reason).toBe(POLICY_REASONS.PRODUCT_EXCLUDED);
    expect(result.dynamicOfferLadder).toBeDefined();
  });

  it("bypasses aiConfidenceThreshold for excluded items", () => {
    const generateOfferLadderFn = vi.fn();

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "WRONG_SIZE",
      customerReason: "wrong_size",
      recoveryRules: [exclusionRule],
      recoveryScore: 10,
      aiConfidenceThreshold: 0.95,
      generateOfferLadderFn,
    });

    expect(result.aiConfidenceBypassed).toBe(true);
    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(result.reason).toBe(POLICY_REASONS.PRODUCT_EXCLUDED);
  });

  it("routes excluded legal items to LEGAL_REVIEW_REQUIRED", () => {
    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "DAMAGED_ITEM",
      customerReason: "damaged_item",
      recoveryRules: [exclusionRule],
    });

    expect(result.reason).toBe(POLICY_REASONS.LEGAL_REVIEW_REQUIRED);
    expect(result.legalFlags).toContain(
      POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
    );
    expect(result.recoveryOffers).toEqual([]);
  });

  it("suppresses exchange, store credit, and partial refund offers when excluded", () => {
    const generateOfferLadderFn = vi.fn();

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "CHANGED_MIND",
      customerReason: "changed_mind",
      recoveryRules: [
        exclusionRule,
        {
          id: "partial",
          type: "PARTIAL_REFUND",
          enabled: true,
          priority: 1,
          conditions: {},
        },
      ],
      generateOfferLadderFn,
    });

    expect(generateOfferLadderFn).not.toHaveBeenCalled();
    expect(result.recoveryOffers).toEqual([]);
    expect(result.aiPersuasionEnabled).toBe(false);
  });

  it("applies aiConfidenceThreshold when not excluded", () => {
    const generateOfferLadderFn = vi.fn(() => ({
      offers: [
        {
          decision: POLICY_DECISIONS.EXCHANGE,
          ruleId: "exchange-rule",
          ruleName: "Exchange",
          ruleType: "EXCHANGE",
          unsafe: false,
        },
      ],
      primaryOffer: {
        decision: POLICY_DECISIONS.EXCHANGE,
        ruleId: "exchange-rule",
        ruleName: "Exchange",
        ruleType: "EXCHANGE",
        unsafe: false,
      },
    }));

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "TEE-001" },
      returnReason: "CHANGED_MIND",
      customerReason: "changed_mind",
      recoveryRules: ladderRules,
      recoveryScore: 40,
      aiConfidenceThreshold: 0.7,
      generateOfferLadderFn,
    });

    expect(generateOfferLadderFn).toHaveBeenCalledOnce();
    expect(result.aiConfidenceBypassed).toBe(false);
    expect(result.aiPersuasionEnabled).toBe(false);
    expect(result.reason).toBe(POLICY_REASONS.NO_SAFE_OPTION);
  });
});
