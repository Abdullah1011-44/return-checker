import { describe, expect, it } from "vitest";
import {
  AI_GUARDRAIL_FLAGS,
  buildAIGuardrailContext,
  validateAIRecommendation,
} from "@/lib/aiGuardrails";
import {
  POLICY_DECISIONS,
  POLICY_GUARDRAILS,
  POLICY_REASONS,
} from "@/lib/returnPolicyEngine";

const UNSAFE_REFUND_DECISIONS = [
  "REFUND",
  "FULL_REFUND",
  "AUTO_REFUND",
  "APPROVE_REFUND",
];

function expectNoRawEnumStrings(message, policyResult = {}) {
  const enumStrings = [
    ...Object.values(POLICY_REASONS),
    ...Object.values(POLICY_GUARDRAILS),
    ...(policyResult.legalFlags ?? []),
    ...(policyResult.secondaryReasons ?? []),
    policyResult.reason,
  ].filter(Boolean);

  const upperMessage = message.toUpperCase();
  for (const code of enumStrings) {
    expect(upperMessage).not.toContain(String(code).toUpperCase());
  }
}

describe("aiGuardrails", () => {
  it("buildAIGuardrailContext blocks auto refunds", () => {
    const context = buildAIGuardrailContext({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
      guardrails: [POLICY_GUARDRAILS.NO_AUTO_REFUND],
    });

    for (const decision of UNSAFE_REFUND_DECISIONS) {
      expect(context.blockedDecisions).toContain(decision);
    }

    expect(
      context.flags.includes(AI_GUARDRAIL_FLAGS.AUTO_REFUND_BLOCKED) ||
        context.flags.includes(AI_GUARDRAIL_FLAGS.UNSAFE_PROMISE_BLOCKED),
    ).toBe(true);
  });

  it("manual review policy forces manual review messaging", () => {
    const context = buildAIGuardrailContext({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
    });

    expect(
      context.mustInclude.some((item) => /merchant|team review/i.test(item)),
    ).toBe(true);
    expect(context.flags).toContain(AI_GUARDRAIL_FLAGS.MANUAL_REVIEW_REQUIRED);
  });

  it("reject policy keeps refund decisions blocked", () => {
    const context = buildAIGuardrailContext({
      decision: POLICY_DECISIONS.REJECT,
      allowedOptions: [POLICY_DECISIONS.REJECT],
      legalFlags: [],
    });

    expect(
      context.mustInclude.some((item) =>
        /does not appear to meet|standard return policy/i.test(item),
      ),
    ).toBe(true);

    for (const decision of UNSAFE_REFUND_DECISIONS) {
      expect(context.blockedDecisions).toContain(decision);
    }
  });

  it("validateAIRecommendation rejects AUTO_REFUND", () => {
    const policyResult = {
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
    };

    const result = validateAIRecommendation({
      policyResult,
      aiRecommendation: {
        decision: "AUTO_REFUND",
        message: "We will process this shortly.",
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.violations).toContain(AI_GUARDRAIL_FLAGS.AUTO_REFUND_BLOCKED);
    expect(result.safeDecision).toBe(policyResult.decision);
  });

  it("validateAIRecommendation rejects policy override", () => {
    const policyResult = {
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
    };

    const result = validateAIRecommendation({
      policyResult,
      aiRecommendation: {
        decision: POLICY_DECISIONS.EXCHANGE,
        message: "You can exchange this item right away.",
      },
    });

    expect(result.isValid).toBe(false);
    expect(
      result.violations.includes(AI_GUARDRAIL_FLAGS.POLICY_OVERRIDE_BLOCKED) ||
        result.violations.includes(AI_GUARDRAIL_FLAGS.MANUAL_REVIEW_REQUIRED),
    ).toBe(true);
    expect(result.safeDecision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
  });

  it("validateAIRecommendation rejects guaranteed refund language", () => {
    const result = validateAIRecommendation({
      policyResult: {
        decision: POLICY_DECISIONS.MANUAL_REVIEW,
        allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
      },
      aiRecommendation: {
        decision: POLICY_DECISIONS.MANUAL_REVIEW,
        message: "Your guaranteed refund is approved.",
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.violations).toContain(
      AI_GUARDRAIL_FLAGS.UNSAFE_PROMISE_BLOCKED,
    );
  });

  it("validateAIRecommendation returns safe fallback message when invalid", () => {
    const policyResult = {
      decision: POLICY_DECISIONS.REJECT,
      allowedOptions: [POLICY_DECISIONS.REJECT],
      reason: POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
      secondaryReasons: [POLICY_REASONS.OUTSIDE_RETURN_WINDOW],
    };

    const result = validateAIRecommendation({
      policyResult,
      aiRecommendation: {
        decision: POLICY_DECISIONS.EXCHANGE,
        message: "Denied because of OUTSIDE_RETURN_WINDOW.",
      },
    });

    expect(result.isValid).toBe(false);
    expect(result.safeDecision).toBe(POLICY_DECISIONS.REJECT);
    expectNoRawEnumStrings(result.safeMessage, policyResult);
    expect(result.safeMessage.length).toBeGreaterThan(0);
  });

  it("validateAIRecommendation accepts valid matching decision", () => {
    const result = validateAIRecommendation({
      policyResult: {
        decision: POLICY_DECISIONS.EXCHANGE,
        allowedOptions: [POLICY_DECISIONS.EXCHANGE],
      },
      aiRecommendation: {
        decision: POLICY_DECISIONS.EXCHANGE,
        message:
          "Based on the store policy, an exchange is the recommended next step for this return request.",
      },
    });

    expect(result.isValid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("legal/ACL flag blocks rejection and refund promises", () => {
    const policyResult = {
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
      legalFlags: [POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY],
    };

    const rejectResult = validateAIRecommendation({
      policyResult,
      aiRecommendation: {
        decision: POLICY_DECISIONS.REJECT,
        message: "This request is rejected.",
      },
    });

    const refundResult = validateAIRecommendation({
      policyResult,
      aiRecommendation: {
        decision: "APPROVE_REFUND",
        message: "Your refund is approved.",
      },
    });

    expect(rejectResult.isValid).toBe(false);
    expect(refundResult.isValid).toBe(false);
    expect(rejectResult.safeDecision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(refundResult.safeDecision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(rejectResult.safeMessage.toLowerCase()).toMatch(/merchant|review/);
    expectNoRawEnumStrings(rejectResult.safeMessage, policyResult);
  });

  it("buildAIGuardrailContext includes raw enum codes in mustNotInclude", () => {
    const context = buildAIGuardrailContext({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      legalFlags: [POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY],
      secondaryReasons: [POLICY_REASONS.OUTSIDE_RETURN_WINDOW],
      guardrails: [POLICY_GUARDRAILS.NO_AUTO_REFUND],
    });

    expect(context.mustNotInclude).toContain(
      POLICY_REASONS.LEGAL_REVIEW_REQUIRED,
    );
    expect(context.mustNotInclude).toContain(
      POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
    );
    expect(context.mustNotInclude).toContain(
      POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
    );
    expect(context.mustNotInclude).toContain(POLICY_GUARDRAILS.NO_AUTO_REFUND);
  });

  it.each([
    "Denied because LEGAL_REVIEW_REQUIRED applies.",
    "This is OUTSIDE_RETURN_WINDOW.",
    "Flag ACL_REFUND_RIGHTS_MAY_APPLY was triggered.",
    "Blocked by MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW.",
  ])(
    "validateAIRecommendation rejects customer-facing messages exposing raw enums: %s",
    (message) => {
      const result = validateAIRecommendation({
        policyResult: {
          decision: POLICY_DECISIONS.MANUAL_REVIEW,
          allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
        },
        aiRecommendation: {
          decision: POLICY_DECISIONS.MANUAL_REVIEW,
          message,
        },
      });

      expect(result.isValid).toBe(false);
      expect(result.violations).toContain(
        AI_GUARDRAIL_FLAGS.INTERNAL_CODE_LEAK_BLOCKED,
      );
    },
  );

  it("safeMessage never contains raw policy, guardrail, legal, or secondary enum strings", () => {
    const policyResult = {
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
      reason: POLICY_REASONS.LEGAL_REVIEW_REQUIRED,
      secondaryReasons: [
        POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
        POLICY_REASONS.DAMAGED_ITEM_REQUIRES_REVIEW,
      ],
      legalFlags: [POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY],
      guardrails: [
        POLICY_GUARDRAILS.MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW,
        POLICY_GUARDRAILS.AI_CANNOT_PROMISE_REFUND,
      ],
    };

    const result = validateAIRecommendation({
      policyResult,
      aiRecommendation: {
        decision: "AUTO_REFUND",
        message: "AUTO_REFUND approved with ACL_REFUND_RIGHTS_MAY_APPLY.",
      },
    });

    expectNoRawEnumStrings(result.safeMessage, policyResult);
    expect(result.safeMessage.toLowerCase()).toMatch(/merchant|review/);
  });
});
