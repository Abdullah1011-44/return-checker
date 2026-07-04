import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOLLOW_UP_BLOCKED_REASONS,
  FOLLOW_UP_SOURCES,
} from "@/lib/followUpQuestionSchemas";

const mockCallAnthropic = vi.fn();

vi.mock("@/lib/anthropicClient", () => ({
  callAnthropic: (...args) => mockCallAnthropic(...args),
  DEFAULT_ANTHROPIC_MODEL: "claude-haiku-4-5-20251001",
  getAnthropicClientConfig: () => ({
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    model: "claude-haiku-4-5-20251001",
    fallbackModel: "claude-sonnet-5",
    timeoutMs: 15000,
    enabled: process.env.FOLLOW_UP_AI_ENABLED === "true",
  }),
  isAnthropicAiEnabled: () => process.env.FOLLOW_UP_AI_ENABLED === "true",
}));

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

const aiEligibleInput = {
  reasonCode: "damaged_item",
  merchantPolicyAllowsAi: true,
  itemInformation: { sku: "SKU-123", productName: "Blue Tee" },
};

describe("followUpQuestionEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FOLLOW_UP_AI_ENABLED;
    delete process.env.ANTHROPIC_API_KEY;
    mockCallAnthropic.mockReset();
  });

  async function evaluate(input) {
    const { evaluateFollowUpQuestion } = await import(
      "@/lib/followUpQuestionEngine"
    );
    return evaluateFollowUpQuestion(input);
  }

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
      async (reasonCode, questionType) => {
        const result = await evaluate({ reasonCode });

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
    it("uses reasonIntelligence followUpType for wrong_size comfort context", async () => {
      const result = await evaluate({
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

    it("uses reasonIntelligence normalizedReason when reasonCode is missing", async () => {
      const result = await evaluate({
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
    it("blocks follow-up for LEGAL_REVIEW_REQUIRED", async () => {
      const result = await evaluate({
        reasonCode: "damaged_item",
        policyStatus: "LEGAL_REVIEW_REQUIRED",
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.LEGAL_REVIEW_REQUIRED,
      );
      expect(result.question).toBeNull();
    });

    it("blocks follow-up for manual_review recommended action", async () => {
      const result = await evaluate({
        reasonCode: "wrong_size",
        recommendedAction: "MANUAL_REVIEW",
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.MANUAL_REVIEW,
      );
    });

    it("blocks follow-up for hard_blocked pipeline state", async () => {
      const result = await evaluate({
        reasonCode: "changed_mind",
        blockedReason: "hard_blocked",
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(FOLLOW_UP_BLOCKED_REASONS.HARD_BLOCKED);
    });

    it("blocks follow-up for consumer law risk flags", async () => {
      const result = await evaluate({
        reasonCode: "damaged_item",
        legalFlags: ["ACL_REFUND_RIGHTS_MAY_APPLY"],
      });

      expect(result.shouldAskFollowUp).toBe(false);
      expect(result.blockedReason).toBe(
        FOLLOW_UP_BLOCKED_REASONS.CONSUMER_LAW_RISK,
      );
    });

    it("blocks follow-up when consumerLawRisk is true", async () => {
      const result = await evaluate({
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
    it("skips follow-up when reasonIntelligence says followUpNeeded is false", async () => {
      const result = await evaluate({
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

    it("skips follow-up when comment already has sufficient detail", async () => {
      const result = await evaluate({
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
    it("handles empty input without throwing", async () => {
      const result = await evaluate();

      expectOutputShape(result);
      expect(result.reasonCode).toBe("other");
    });

    it("normalizes unknown reason to other fallback", async () => {
      const result = await evaluate({ reasonCode: "mystery_reason" });

      expect(result.reasonCode).toBe("other");
      expect(result.shouldAskFollowUp).toBe(true);
      expect(result.questionType).toBe("clarify_reason");
    });
  });

  describe("AI integration", () => {
    it("returns fallback immediately when AI is disabled", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "false";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      const result = await evaluate({
        ...aiEligibleInput,
      });

      expect(mockCallAnthropic).not.toHaveBeenCalled();
      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
      expect(result.fallbackUsed).toBe(true);
    });

    it("returns fallback when API key is missing", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";

      const result = await evaluate({
        ...aiEligibleInput,
      });

      expect(mockCallAnthropic).not.toHaveBeenCalled();
      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("returns fallback when merchant policy does not allow AI", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      const result = await evaluate({
        reasonCode: "damaged_item",
        merchantPolicyAllowsAi: false,
      });

      expect(mockCallAnthropic).not.toHaveBeenCalled();
      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("returns fallback when item is hard blocked", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      const result = await evaluate({
        ...aiEligibleInput,
        itemHardBlocked: true,
      });

      expect(mockCallAnthropic).not.toHaveBeenCalled();
      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("returns AI question when generation succeeds", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: true,
        model: "claude-haiku-4-5-20251001",
        structuredOutputUsed: true,
        parsedOutput: {
          question: "Could you describe where the damage appears on the item?",
          questionType: "damage_details",
          confidence: 0.91,
        },
      });

      const result = await evaluate({
        ...aiEligibleInput,
        policyResult: { status: "review" },
      });

      expect(mockCallAnthropic).toHaveBeenCalledOnce();
      expect(result.source).toBe(FOLLOW_UP_SOURCES.AI);
      expect(result.fallbackUsed).toBe(false);
      expect(result.question).toContain("damage");
    });

    it("returns fallback on timeout", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: false,
        errorType: "timeout",
      });

      const result = await evaluate(aiEligibleInput);

      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
      expect(result.fallbackUsed).toBe(true);
    });

    it("returns fallback on invalid structured output", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: true,
        parsedOutput: {
          question: "Hi",
          questionType: "not_a_real_type",
        },
      });

      const result = await evaluate(aiEligibleInput);

      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("returns fallback for unsafe refund promise language", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: true,
        parsedOutput: {
          question: "You will receive a refund once we review this, okay?",
          questionType: "damage_details",
        },
      });

      const result = await evaluate(aiEligibleInput);

      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("returns fallback for approval language", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: true,
        parsedOutput: {
          question: "Your request is approved for a return, right?",
          questionType: "damage_details",
        },
      });

      const result = await evaluate(aiEligibleInput);

      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("returns fallback for multiple questions", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: true,
        parsedOutput: {
          question: "What happened? Can you send a photo?",
          questionType: "damage_details",
        },
      });

      const result = await evaluate(aiEligibleInput);

      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("returns fallback for customer blame language", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: true,
        parsedOutput: {
          question: "Was this damage your fault during unpacking?",
          questionType: "damage_details",
        },
      });

      const result = await evaluate(aiEligibleInput);

      expect(result.source).toBe(FOLLOW_UP_SOURCES.FALLBACK);
    });

    it("uses Sonnet when caller requests it", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic.mockResolvedValue({
        success: true,
        parsedOutput: {
          question: "Could you share when you first noticed the issue?",
          questionType: "damage_details",
        },
      });

      await evaluate({
        ...aiEligibleInput,
        aiModel: "claude-sonnet-5",
      });

      expect(mockCallAnthropic.mock.calls[0][0].model).toBe("claude-sonnet-5");
    });

    it("falls back to prompt parse when structured output unavailable", async () => {
      process.env.FOLLOW_UP_AI_ENABLED = "true";
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";

      mockCallAnthropic
        .mockResolvedValueOnce({
          success: false,
          errorType: "structured_output_unavailable",
        })
        .mockResolvedValueOnce({
          success: true,
          content:
            '{"question":"Could you describe the crack location?","questionType":"damage_details"}',
        });

      const result = await evaluate(aiEligibleInput);

      expect(mockCallAnthropic).toHaveBeenCalledTimes(2);
      expect(result.source).toBe(FOLLOW_UP_SOURCES.AI);
      expect(result.question).toContain("crack");
    });
  });
});
