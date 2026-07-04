import { describe, expect, it } from "vitest";
import { evaluateFollowUpQuestion } from "@/lib/followUpQuestionEngine";
import {
  FOLLOW_UP_BLOCKED_REASONS,
  FOLLOW_UP_SOURCES,
} from "@/lib/followUpQuestionSchemas";

function expectOutputShape(result) {
  expect(result).toMatchObject({
    shouldAskFollowUp: expect.any(Boolean),
    question: result.shouldAskFollowUp ? expect.any(String) : null,
    questionType: result.shouldAskFollowUp ? expect.any(String) : null,
    reasonCode: expect.any(String),
    confidence: expect.any(Number),
    source: expect.any(String),
    fallbackUsed: expect.any(Boolean),
    blockedReason: result.shouldAskFollowUp ? null : expect.anything(),
  });
}

describe("followUpQuestionEngine", () => {
  describe("fallback follow-up questions", () => {
    it.each([
      ["wrong_size", "size_preference"],
      ["damaged_item", "damage_details"],
      ["changed_mind", "preference_reason"],
      ["late_delivery", "fulfillment_details"],
      ["wrong_item", "wrong_item_details"],
      ["other", "clarify_reason"],
    ])(
      "reason %s returns fallback question with type %s",
      (reasonCode, questionType) => {
        const result = evaluateFollowUpQuestion({ reasonCode });

        expectOutputShape(result);
        expect(result.shouldAskFollowUp).toBe(true);
        expect(result.questionType).toBe(questionType);
        expect(result.reasonCode).toBe(reasonCode);
        expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
        expect(result.fallbackUsed).toBe(true);
        expect(result.blockedReason).toBeNull();
        expect(result.question).toMatch(/\?$/);
      },
    );
  });

  describe("reason intelligence integration", () => {
    it("uses reasonIntelligence followUpType for wrong_size comfort context", () => {
      const result = evaluateFollowUpQuestion({
        reasonIntelligence: {
          normalizedReason: "wrong_size",
          followUpNeeded: true,
          followUpType: "size_or_comfort_preference",
        },
      });

      expect(result.shouldAskFollowUp).toBe(true);
      expect(result.questionType).toBe("size_or_comfort_preference");
      expect(result.reasonCode).toBe("wrong_size");
    });

    it("uses reasonIntelligence normalizedReason when reasonCode is missing", () => {
      const result = evaluateFollowUpQuestion({
        reasonIntelligence: {
          normalizedReason: "damaged_item",
          followUpNeeded: true,
          followUpType: "fault_details",
        },
      });

      expect(result.reasonCode).toBe("damaged_item");
      expect(result.questionType).toBe("fault_details");
    });
  });

  describe("short-circuit blocked behavior", () => {
    it("blocks follow-up for LEGAL_REVIEW_REQUIRED", () => {
      const result = evaluateFollowUpQuestion({
        reasonCode: "damaged_item",
        policyStatus: "LEGAL_REVIEW_REQUIRED",
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.LEGAL_REVIEW_REQUIRED,
      );
      expect(result.question).toBeNull();
    });

    it("blocks follow-up for manual_review recommended action", () => {
      const result = evaluateFollowUpQuestion({
        reasonCode: "wrong_size",
        recommendedAction: "MANUAL_REVIEW",
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.MANUAL_REVIEW,
      );
    });

    it("blocks follow-up for hard_blocked pipeline state", () => {
      const result = evaluateFollowUpQuestion({
        reasonCode: "changed_mind",
        blockedReason: "hard_blocked",
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(FOLLOW_UP_BLOCKED_REASONS.HARD_BLOCKED);
    });

    it("blocks follow-up for consumer law risk flags", () => {
      const result = evaluateFollowUpQuestion({
        reasonCode: "damaged_item",
        legalFlags: ["ACL_REFUND_RIGHTS_MAY_APPLY"],
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.CONSUMER_LAW_RISK,
      );
    });

    it("blocks follow-up when consumerLawRisk is true", () => {
      const result = evaluateFollowUpQuestion({
        reasonCode: "damaged_item",
        consumerLawRisk: true,
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.CONSUMER_LAW_RISK,
      );
    });
  });

  describe("follow-up not needed", () => {
    it("skips follow-up when reasonIntelligence says followUpNeeded is false", () => {
      const result = evaluateFollowUpQuestion({
        reasonIntelligence: {
          normalizedReason: "late_delivery",
          followUpNeeded: false,
          followUpType: null,
        },
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.FOLLOW_UP_NOT_NEEDED,
      );
    });

    it("skips follow-up when comment already has sufficient detail", () => {
      const result = evaluateFollowUpQuestion({
        reasonCode: "wrong_size",
        comment: "It is too small and I would like to exchange for a medium.",
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.SUFFICIENT_DETAIL_PROVIDED,
      );
    });
  });

  describe("missing inputs", () => {
    it("handles empty input without throwing", () => {
      const result = evaluateFollowUpQuestion();

      expectOutputShape(result);
      expect(result.reasonCode).toBe("other");
    });

    it("normalizes unknown reason to other fallback", () => {
      const result = evaluateFollowUpQuestion({ reasonCode: "mystery_reason" });

      expect(result.reasonCode).toBe("other");
      expect(result.shouldAskFollowUp).toBe(true);
      expect(result.questionType).toBe("clarify_reason");
    });
  });
});
