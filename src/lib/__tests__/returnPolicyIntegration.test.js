import { describe, expect, it } from "vitest";
import { POLICY_DECISIONS, POLICY_REASONS } from "@/lib/returnPolicyEngine";
import {
  buildMerchantSettingsForPolicy,
  buildPolicyItemsFromSubmission,
  buildReturnRequestInput,
  evaluateReturnPolicyForCheck,
  policyDecisionToBestAction,
  serializeCustomerPolicyResult,
  serializePolicyResultForApi,
} from "@/lib/returnPolicyIntegration";

describe("returnPolicyIntegration", () => {
  it("merges merchant and settings fields for policy evaluation", () => {
    const settings = buildMerchantSettingsForPolicy(
      {
        returnWindowDays: 45,
        allowExchange: true,
        allowStoreCredit: false,
        allowPartialRefund: true,
      },
      {
        returnWindow: 30,
        allowExchange: false,
        allowStoreCredit: true,
        allowPartialRefund: false,
      },
    );

    expect(settings.returnWindowDays).toBe(30);
    expect(settings.allowExchanges).toBe(false);
    expect(settings.allowStoreCredit).toBe(true);
    expect(settings.allowPartialRefunds).toBe(false);
    expect(settings.allowManualReviewFallback).toBe(true);
  });

  it("maps policy decisions to customer-facing recommendation labels", () => {
    expect(policyDecisionToBestAction(POLICY_DECISIONS.EXCHANGE)).toBe(
      "Exchange Product",
    );
    expect(policyDecisionToBestAction(POLICY_DECISIONS.REJECT)).toBe(
      "Manual Review",
    );
  });

  it("builds return request input from submitted items", () => {
    const input = buildReturnRequestInput([
      { returnReason: "damaged_item", comment: "Broken zipper" },
      { returnReason: "wrong_size", comment: "Too small" },
    ]);

    expect(input.reason).toBe("DAMAGED_ITEM");
    expect(input.comment).toContain("Broken zipper");
    expect(input.riskLevel).toBe("HIGH");
  });

  it("builds policy items with merchant-scoped order item context", () => {
    const items = buildPolicyItemsFromSubmission(
      [{ isReturnable: true }, { isReturnable: false }],
      [
        { returnReason: "changed_mind", comment: "No longer needed" },
        { returnReason: "damaged_item", comment: "Torn seam" },
      ],
    );

    expect(items[0].reason).toBe("CHANGED_MIND");
    expect(items[1].riskLevel).toBe("HIGH");
    expect(items[1].orderItem.isReturnable).toBe(false);
  });

  it("evaluates check-return policy without requiring persisted settings", async () => {
    const deliveredAt = new Date();
    deliveredAt.setUTCDate(deliveredAt.getUTCDate() - 5);

    const result = await evaluateReturnPolicyForCheck({
      order: {
        deliveredAt: deliveredAt.toISOString(),
        totalAmount: 120,
        items: [{ isReturnable: true }],
      },
    });

    expect(result.decision).not.toBe("REFUND");
    expect(result.customerMessage).toBeTruthy();
    expect(result.customerMessage).not.toContain("NO_AUTO_REFUND");
  });

  it("serializes customer-safe policy results without internal enum fields", () => {
    const serialized = serializeCustomerPolicyResult({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      customerMessage:
        "Thanks for sharing the issue. Your request needs to be reviewed by the merchant team before a final outcome is confirmed.",
      allowedOptions: [
        POLICY_DECISIONS.EXCHANGE,
        POLICY_DECISIONS.MANUAL_REVIEW,
      ],
      confidence: "LOW",
      reason: POLICY_REASONS.LEGAL_REVIEW_REQUIRED,
      secondaryReasons: [POLICY_REASONS.OUTSIDE_RETURN_WINDOW],
      legalFlags: [POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY],
      guardrails: ["MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW"],
      merchantNote:
        "Policy decision: MANUAL_REVIEW. Primary reason: LEGAL_REVIEW_REQUIRED.",
    });

    expect(serialized).not.toHaveProperty("reason");
    expect(serialized).not.toHaveProperty("secondaryReasons");
    expect(serialized).not.toHaveProperty("legalFlags");
    expect(serialized).not.toHaveProperty("merchantNote");
    expect(serialized.recommendedAction).toBe("Manual Review");
    expect(serialized.customerMessage).not.toContain("LEGAL_REVIEW_REQUIRED");
    expect(serialized.customerMessage).not.toContain("OUTSIDE_RETURN_WINDOW");
  });

  it("serializes API policy results with matched rule metadata", () => {
    const serialized = serializePolicyResultForApi({
      decision: POLICY_DECISIONS.EXCHANGE,
      customerMessage:
        "Based on the store policy, an exchange is the recommended next step for this return request.",
      allowedOptions: [POLICY_DECISIONS.EXCHANGE],
      confidence: "HIGH",
      matchedRuleId: "rule-1",
      matchedRuleName: "Exchange for changed mind",
    });

    expect(serialized.matchedRuleId).toBe("rule-1");
    expect(serialized.matchedRuleName).toBe("Exchange for changed mind");
    expect(serialized.recommendedAction).toBe("Exchange Product");
  });
});
