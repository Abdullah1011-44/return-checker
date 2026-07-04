import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_SAFETY_VIOLATIONS,
  sanitizeFollowUpQuestion,
  validateFollowUpQuestionContent,
} from "@/lib/followUpQuestionSafety";

describe("followUpQuestionSafety", () => {
  it("accepts safe fallback-style questions", () => {
    const result = validateFollowUpQuestionContent(
      "Could you briefly describe the damage and share a photo if you have one?",
    );

    expect(result.safe).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.blockedReason).toBeNull();
  });

  it("rejects empty questions", () => {
    const result = validateFollowUpQuestionContent("   ");

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.EMPTY_QUESTION,
    );
  });

  it("rejects refund promises", () => {
    const result = validateFollowUpQuestionContent(
      "You will get a refund once you upload a photo.",
    );

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.REFUND_PROMISE,
    );
  });

  it("rejects approval decisions", () => {
    const result = validateFollowUpQuestionContent(
      "Your request is approved for a refund.",
    );

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.APPROVAL_DECISION,
    );
  });

  it("rejects rejection decisions", () => {
    const result = validateFollowUpQuestionContent(
      "Your request is rejected because the item is not eligible for return.",
    );

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.REJECTION_DECISION,
    );
  });

  it("rejects internal strategy and risk score language", () => {
    const result = validateFollowUpQuestionContent(
      "Based on your risk score, can you share more details?",
    );

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.INTERNAL_STRATEGY,
    );
  });

  it("rejects blame language", () => {
    const result = validateFollowUpQuestionContent(
      "This is your fault — why did you not check the size?",
    );

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.BLAME_LANGUAGE,
    );
  });

  it("rejects more than one question", () => {
    const result = validateFollowUpQuestionContent(
      "What size do you need? Can you also share a photo?",
    );

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.MULTIPLE_QUESTIONS,
    );
  });

  it("rejects unnecessary sensitive data requests", () => {
    const result = validateFollowUpQuestionContent(
      "Please share your credit card number for verification.",
    );

    expect(result.safe).toBe(false);
    expect(result.violations).toContain(
      FOLLOW_UP_SAFETY_VIOLATIONS.SENSITIVE_DATA_REQUEST,
    );
  });

  it("sanitizeFollowUpQuestion returns trimmed safe text", () => {
    expect(sanitizeFollowUpQuestion("  Could you share a photo?  ")).toBe(
      "Could you share a photo?",
    );
  });

  it("sanitizeFollowUpQuestion returns null for unsafe content", () => {
    expect(sanitizeFollowUpQuestion("Your refund is guaranteed.")).toBeNull();
  });
});
