import { describe, expect, it } from "vitest";
import {
  FALLBACK_QUESTIONS_BY_REASON,
  isSupportedFollowUpReasonCode,
  resolveFallbackFollowUpQuestion,
} from "@/lib/followUpQuestionPrompts";
import { validateFollowUpQuestionContent } from "@/lib/followUpQuestionSafety";

describe("followUpQuestionPrompts", () => {
  it("provides fallback questions for all supported reason codes", () => {
    for (const reasonCode of Object.keys(FALLBACK_QUESTIONS_BY_REASON)) {
      const fallback = resolveFallbackFollowUpQuestion({ reasonCode });

      expect(fallback.question).toBeTruthy();
      expect(fallback.questionType).toBeTruthy();
      expect(fallback.confidence).toBeGreaterThan(0);
      expect(fallback.reasonCode).toBe(reasonCode);
    }
  });

  it("prefers followUpType-specific fallback when available", () => {
    const fallback = resolveFallbackFollowUpQuestion({
      reasonCode: "wrong_size",
      followUpType: "dimension_preference",
    });

    expect(fallback.questionType).toBe("dimension_preference");
    expect(fallback.question).toContain("dimensions");
  });

  it("falls back to reason code when followUpType is unknown", () => {
    const fallback = resolveFallbackFollowUpQuestion({
      reasonCode: "wrong_size",
      followUpType: "unknown_type",
    });

    expect(fallback.questionType).toBe("size_preference");
  });

  it("all built-in fallback questions pass safety validation", () => {
    for (const reasonCode of Object.keys(FALLBACK_QUESTIONS_BY_REASON)) {
      const fallback = resolveFallbackFollowUpQuestion({ reasonCode });
      const safety = validateFollowUpQuestionContent(fallback.question);

      expect(safety.safe).toBe(true);
    }
  });

  it("isSupportedFollowUpReasonCode recognizes aliases", () => {
    expect(isSupportedFollowUpReasonCode("wrong_size")).toBe(true);
    expect(isSupportedFollowUpReasonCode("damaged")).toBe(true);
    expect(isSupportedFollowUpReasonCode("unknown")).toBe(true);
  });
});
