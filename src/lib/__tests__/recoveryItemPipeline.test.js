import { describe, expect, it, vi } from "vitest";
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
  });

  it("does not invoke generateOfferLadder for excluded items", () => {
    const generateOfferLadderFn = vi.fn();

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "CHANGED_MIND",
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
  });

  it("bypasses aiConfidenceThreshold for excluded items", () => {
    const generateOfferLadderFn = vi.fn();

    const result = evaluateItemRecoveryPipeline({
      itemContext: { sku: "FINAL-SALE-001" },
      returnReason: "WRONG_SIZE",
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
