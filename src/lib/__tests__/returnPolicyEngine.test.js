import { describe, expect, it } from "vitest";
import {
  evaluateReturnPolicy,
  POLICY_DECISIONS,
  POLICY_GUARDRAILS,
  POLICY_REASONS,
} from "@/lib/returnPolicyEngine";

const UNSAFE_DECISIONS = [
  "REFUND",
  "FULL_REFUND",
  "AUTO_REFUND",
  "APPROVE_REFUND",
];

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function evaluate(overrides = {}) {
  const {
    merchantSettings,
    recoveryRules = [],
    returnRequest = { reason: "CHANGED_MIND" },
    order = { deliveredAt: daysAgo(5) },
    items = [],
  } = overrides;

  return evaluateReturnPolicy({
    merchantSettings,
    recoveryRules,
    returnRequest,
    order,
    items,
  });
}

function hasReasonOrSecondary(result, code) {
  return result.reason === code || result.secondaryReasons.includes(code);
}

describe("returnPolicyEngine", () => {
  it("uses safe defaults when merchantSettings is missing", () => {
    expect(() =>
      evaluate({
        merchantSettings: undefined,
        returnRequest: { reason: "CHANGED_MIND" },
        order: { deliveredAt: daysAgo(10) },
      }),
    ).not.toThrow();

    const inWindow = evaluate({
      merchantSettings: undefined,
      returnRequest: { reason: "CHANGED_MIND" },
      order: { deliveredAt: daysAgo(10) },
    });

    expect(inWindow.allowedOptions).toContain(POLICY_DECISIONS.EXCHANGE);
    expect(inWindow.allowedOptions).toContain(POLICY_DECISIONS.STORE_CREDIT);
    expect(inWindow.blockedOptions).toContain(POLICY_DECISIONS.PARTIAL_REFUND);
    expect(inWindow.allowedOptions).toContain(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(UNSAFE_DECISIONS).not.toContain(inWindow.decision);

    const outsideDefaultWindow = evaluate({
      merchantSettings: undefined,
      returnRequest: { reason: "CHANGED_MIND" },
      order: { deliveredAt: daysAgo(31) },
    });
    expect(outsideDefaultWindow.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);

    const insideWindow = evaluate({
      merchantSettings: undefined,
      returnRequest: { reason: "CHANGED_MIND" },
      order: { deliveredAt: daysAgo(29) },
    });
    expect(insideWindow.decision).not.toBe(POLICY_DECISIONS.REJECT);
  });

  describe("outside return window", () => {
    it("rejects when manual review fallback is disabled", () => {
      const result = evaluate({
        merchantSettings: {
          returnWindowDays: 30,
          allowManualReviewFallback: false,
        },
        order: { deliveredAt: daysAgo(45) },
      });

      expect(result.decision).toBe(POLICY_DECISIONS.REJECT);
      expect(
        hasReasonOrSecondary(result, POLICY_REASONS.OUTSIDE_RETURN_WINDOW),
      ).toBe(true);
    });

    it("manual-reviews when manual review fallback is enabled", () => {
      const result = evaluate({
        merchantSettings: {
          returnWindowDays: 30,
          allowManualReviewFallback: true,
        },
        order: { deliveredAt: daysAgo(45) },
      });

      expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
      expect(
        hasReasonOrSecondary(result, POLICY_REASONS.OUTSIDE_RETURN_WINDOW),
      ).toBe(true);
    });
  });

  it("forces MANUAL_REVIEW when deliveredAt is missing", () => {
    const result = evaluate({
      returnRequest: { reason: "CHANGED_MIND" },
      order: {},
    });

    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(
      result.reason === POLICY_REASONS.MISSING_DELIVERED_AT ||
        result.secondaryReasons.includes(POLICY_REASONS.MISSING_DELIVERED_AT),
    ).toBe(true);
    expect(result.confidence).toBe("LOW");
    expect(result.guardrails).toContain(
      POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED,
    );
  });

  it("forces MANUAL_REVIEW for high risk requests", () => {
    const result = evaluate({
      returnRequest: { reason: "CHANGED_MIND", riskLevel: "HIGH" },
      order: { deliveredAt: daysAgo(5) },
    });

    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(hasReasonOrSecondary(result, POLICY_REASONS.HIGH_RISK_REQUEST)).toBe(
      true,
    );
    expect(result.guardrails).toContain(
      POLICY_GUARDRAILS.HIGH_RISK_REQUIRES_REVIEW,
    );
  });

  it("forces MANUAL_REVIEW for damaged_item by default", () => {
    const result = evaluate({
      returnRequest: { reason: "DAMAGED_ITEM" },
      order: { deliveredAt: daysAgo(5) },
    });

    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(
      hasReasonOrSecondary(
        result,
        POLICY_REASONS.DAMAGED_ITEM_REQUIRES_REVIEW,
      ) || hasReasonOrSecondary(result, POLICY_REASONS.LEGAL_REVIEW_REQUIRED),
    ).toBe(true);
    expect(result.guardrails).toContain(POLICY_GUARDRAILS.NO_AUTO_REFUND);
    expect(UNSAFE_DECISIONS).not.toContain(result.decision);
  });

  it("does not allow PARTIAL_REFUND when allowPartialRefunds is false", () => {
    const result = evaluate({
      merchantSettings: { allowPartialRefunds: false },
      recoveryRules: [
        {
          id: "partial-rule",
          name: "Partial refund rule",
          type: "PARTIAL_REFUND",
          enabled: true,
          priority: 1,
          conditions: {},
        },
      ],
    });

    expect(result.decision).not.toBe(POLICY_DECISIONS.PARTIAL_REFUND);
    expect(result.blockedOptions).toContain(POLICY_DECISIONS.PARTIAL_REFUND);
    expect(
      hasReasonOrSecondary(result, POLICY_REASONS.SETTINGS_BLOCK_RULE_ACTION) ||
        hasReasonOrSecondary(result, POLICY_REASONS.NO_SAFE_OPTION),
    ).toBe(true);
    expect(result.guardrails).toContain(
      POLICY_GUARDRAILS.SETTINGS_OVERRIDE_RECOVERY_RULES,
    );
  });

  it("allows EXCHANGE when matching enabled rule action is EXCHANGE and exchanges are enabled", () => {
    const result = evaluate({
      merchantSettings: { allowExchanges: true },
      recoveryRules: [
        {
          id: "exchange-rule",
          name: "Exchange for changed mind",
          type: "EXCHANGE",
          enabled: true,
          priority: 1,
          conditions: { reason: "CHANGED_MIND" },
        },
      ],
      returnRequest: { reason: "CHANGED_MIND" },
    });

    expect(result.decision).toBe(POLICY_DECISIONS.EXCHANGE);
    expect(result.reason).toBe(POLICY_REASONS.RULE_MATCHED);
    expect(result.matchedRuleId).toBe("exchange-rule");
    expect(result.matchedRuleName).toBe("Exchange for changed mind");
    expect(result.confidence).toBe("HIGH");
  });

  it("ignores disabled recovery rules", () => {
    const result = evaluate({
      recoveryRules: [
        {
          id: "disabled-exchange",
          name: "Disabled exchange",
          type: "EXCHANGE",
          enabled: false,
          priority: 1,
          conditions: {},
        },
        {
          id: "enabled-credit",
          name: "Enabled store credit",
          type: "STORE_CREDIT",
          enabled: true,
          priority: 2,
          conditions: {},
        },
      ],
    });

    expect(result.decision).toBe(POLICY_DECISIONS.STORE_CREDIT);
    expect(result.matchedRuleId).toBe("enabled-credit");
    expect(result.matchedRuleName).toBe("Enabled store credit");
  });

  it("uses priority order when multiple rules match", () => {
    const result = evaluate({
      recoveryRules: [
        {
          id: "priority-1-exchange",
          name: "Priority 1 exchange",
          type: "EXCHANGE",
          enabled: true,
          priority: 1,
          conditions: {},
        },
        {
          id: "priority-2-credit",
          name: "Priority 2 store credit",
          type: "STORE_CREDIT",
          enabled: true,
          priority: 2,
          conditions: {},
        },
      ],
    });

    expect(result.decision).toBe(POLICY_DECISIONS.EXCHANGE);
    expect(result.matchedRuleId).toBe("priority-1-exchange");
  });

  it.each([
    "REFUND",
    "FULL_REFUND",
    "AUTO_REFUND",
    "APPROVE_REFUND",
    "SOMETHING_UNKNOWN",
  ])("never returns unsafe or unknown decision for action %s", (action) => {
    const result = evaluate({
      recoveryRules: [
        {
          id: `unsafe-${action}`,
          name: `Unsafe ${action}`,
          action,
          enabled: true,
          priority: 1,
          conditions: {},
        },
      ],
    });

    expect(Object.values(POLICY_DECISIONS)).toContain(result.decision);
    expect(UNSAFE_DECISIONS).not.toContain(result.decision);

    if (UNSAFE_DECISIONS.includes(action) || action === "SOMETHING_UNKNOWN") {
      expect(result.guardrails).toContain(POLICY_GUARDRAILS.NO_AUTO_REFUND);
    }
  });

  it.each([
    "FAULTY",
    "DEFECTIVE",
    "NOT_AS_DESCRIBED",
    "DAMAGED_ITEM",
    "WRONG_ITEM",
  ])("legal/ACL issue triggers MANUAL_REVIEW for reason %s", (reason) => {
    const result = evaluate({
      returnRequest: { reason },
      order: { deliveredAt: daysAgo(5) },
    });

    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(result.reason).toBe(POLICY_REASONS.LEGAL_REVIEW_REQUIRED);
    expect(result.legalFlags).toContain(
      POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
    );
    expect(result.guardrails).toContain(
      POLICY_GUARDRAILS.MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW,
    );
    expect(result.guardrails).toContain(
      POLICY_GUARDRAILS.AI_CANNOT_PROMISE_REFUND,
    );
    expect(result.guardrails).toContain(
      POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED,
    );
    expect(UNSAFE_DECISIONS).not.toContain(result.decision);
  });

  it("does not reject ACL issues only because they are outside the return window", () => {
    const result = evaluate({
      merchantSettings: {
        returnWindowDays: 30,
        allowManualReviewFallback: false,
      },
      returnRequest: { reason: "NOT_AS_DESCRIBED" },
      order: { deliveredAt: daysAgo(60) },
    });

    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(result.reason).toBe(POLICY_REASONS.LEGAL_REVIEW_REQUIRED);
    expect(result.secondaryReasons).toContain(
      POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
    );
    expect(result.legalFlags).toContain(
      POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
    );
    expect(result.decision).not.toBe(POLICY_DECISIONS.REJECT);
  });

  it.each(["CHANGED_MIND", "WRONG_SIZE", "DOES_NOT_FIT"])(
    "buyer-remorse reason %s does not trigger ACL legalFlags by default",
    (reason) => {
      const result = evaluate({
        returnRequest: { reason },
        order: { deliveredAt: daysAgo(5) },
      });

      expect(result.legalFlags).not.toContain(
        POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
      );
    },
  );

  it("keeps secondaryReasons and blockedOptions distinct", () => {
    const result = evaluate({
      merchantSettings: {
        allowPartialRefunds: false,
        returnWindowDays: 30,
        allowManualReviewFallback: true,
      },
      returnRequest: { reason: "CHANGED_MIND" },
      order: { deliveredAt: daysAgo(45) },
    });

    expect(result.secondaryReasons).toContain(
      POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
    );
    expect(result.blockedOptions).toContain(POLICY_DECISIONS.PARTIAL_REFUND);
    expect(result.secondaryReasons).not.toContain(
      POLICY_DECISIONS.PARTIAL_REFUND,
    );
    expect(result.blockedOptions).not.toEqual(result.secondaryReasons);
  });

  it("customerMessage never contains raw policy or legal enum strings", () => {
    const result = evaluate({
      returnRequest: { reason: "FAULTY" },
      order: { deliveredAt: daysAgo(60) },
    });

    const forbidden = [
      POLICY_REASONS.LEGAL_REVIEW_REQUIRED,
      POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
      POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
      POLICY_GUARDRAILS.MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW,
    ];

    for (const code of forbidden) {
      expect(result.customerMessage.toUpperCase()).not.toContain(code);
    }
  });
});
