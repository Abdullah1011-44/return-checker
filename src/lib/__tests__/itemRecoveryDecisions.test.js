import { describe, expect, it, vi } from "vitest";
import {
  EXCLUDED_ITEM_CUSTOMER_MESSAGE,
  evaluateOrderItemRecoveryDecision,
  evaluateSubmitReturnItemDecisions,
} from "@/lib/itemRecoveryDecisions";
import { PRODUCT_EXCLUSION_RULE_TYPE } from "@/lib/productExclusion";
import { generateOfferLadder } from "@/lib/returnPolicyEngine";

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
      id: "normal-sku",
      matcherType: "sku",
      value: "FINAL-SALE-001",
      reason: "Product is excluded from automated return recovery",
    },
  ],
  actions: {},
};

const ladderRules = [
  {
    id: "exchange-rule",
    type: "EXCHANGE",
    enabled: true,
    priority: 1,
    conditions: {},
  },
];

const merchantSettings = {
  allowExchanges: true,
  allowStoreCredit: true,
  allowPartialRefunds: true,
  allowManualReviewFallback: true,
  returnWindowDays: 30,
};

describe("itemRecoveryDecisions", () => {
  it("routes excluded change-of-mind items to MANUAL_REVIEW with safe customer copy", async () => {
    const decision = await evaluateOrderItemRecoveryDecision({
      orderItem: { id: "item-1", sku: "FINAL-SALE-001" },
      returnReason: "changed_mind",
      merchantSettings,
      recoveryRules: [...ladderRules, exclusionRule],
      productExclusionRule: exclusionRule,
    });

    expect(decision.productExcluded).toBe(true);
    expect(decision.recommendedAction).toBe("MANUAL_REVIEW");
    expect(decision.customerMessage).toBe(EXCLUDED_ITEM_CUSTOMER_MESSAGE);
    expect(decision.exclusionReason).toBe(
      "Product is excluded from automated return recovery",
    );
    expect(decision.exclusionRuleId).toBe("normal-sku");
    expect(decision.recoveryOffers).toEqual([]);
    expect(decision.aiOfferSuppressed).toBe(true);
    expect(decision.customerMessage).not.toContain(decision.exclusionRuleId);
  });

  it("routes excluded damaged items to LEGAL_REVIEW_REQUIRED", async () => {
    const decision = await evaluateOrderItemRecoveryDecision({
      orderItem: { id: "item-1", sku: "FINAL-SALE-001" },
      returnReason: "damaged_item",
      merchantSettings,
      recoveryRules: [...ladderRules, exclusionRule],
      productExclusionRule: exclusionRule,
    });

    expect(decision.recommendedAction).toBe("LEGAL_REVIEW_REQUIRED");
    expect(decision.customerMessage).toBe(EXCLUDED_ITEM_CUSTOMER_MESSAGE);
    expect(decision.aiOfferSuppressed).toBe(true);
  });

  it("does not call generateOfferLadder for excluded items", async () => {
    const generateOfferLadderFn = vi.fn();

    await evaluateOrderItemRecoveryDecision({
      orderItem: { id: "item-1", sku: "FINAL-SALE-001" },
      returnReason: "changed_mind",
      merchantSettings,
      recoveryRules: [...ladderRules, exclusionRule],
      productExclusionRule: exclusionRule,
      generateOfferLadderFn,
    });

    expect(generateOfferLadderFn).not.toHaveBeenCalled();
  });

  it("still runs offer ladder for non-excluded items", async () => {
    const generateOfferLadderFn = vi.fn((input) => generateOfferLadder(input));

    const decision = await evaluateOrderItemRecoveryDecision({
      orderItem: { id: "item-2", sku: "TEE-001" },
      returnReason: "changed_mind",
      merchantSettings,
      recoveryRules: [...ladderRules, exclusionRule],
      productExclusionRule: exclusionRule,
      generateOfferLadderFn,
    });

    expect(generateOfferLadderFn).toHaveBeenCalledOnce();
    expect(decision.productExcluded).toBe(false);
    expect(decision.recommendedAction).toBe("OFFER_EXCHANGE");
    expect(decision.aiOfferSuppressed).toBe(false);
  });

  it("handles mixed multi-item submit decisions independently", async () => {
    const result = await evaluateSubmitReturnItemDecisions({
      merchantId: "merchant-1",
      merchant: { id: "merchant-1" },
      settings: { aiConfidence: 0.7 },
      recoveryRules: [...ladderRules, exclusionRule],
      order: {
        deliveredAt: new Date().toISOString(),
        totalAmount: 120,
      },
      matchedOrderItems: [
        { id: "item-1", sku: "TEE-001" },
        { id: "item-2", sku: "FINAL-SALE-001" },
      ],
      returnRequestItems: [
        { itemId: "item-1", returnReason: "changed_mind" },
        { itemId: "item-2", returnReason: "wrong_size" },
      ],
    });

    expect(result.hasExcludedItems).toBe(true);
    expect(result.itemDecisions[0].productExcluded).toBe(false);
    expect(result.itemDecisions[0].recommendedAction).toBe("OFFER_EXCHANGE");
    expect(result.itemDecisions[1].productExcluded).toBe(true);
    expect(result.itemDecisions[1].recommendedAction).toBe("MANUAL_REVIEW");
  });
});
