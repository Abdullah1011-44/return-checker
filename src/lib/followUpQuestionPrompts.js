/**
 * Fallback follow-up question templates (Task 35 — Prompt 1).
 * Deterministic customer-safe prompts — no LLM calls.
 */

import {
  FOLLOW_UP_REASON_CODES,
  normalizeFollowUpQuestionType,
  normalizeFollowUpReasonCode,
} from "@/lib/followUpQuestionSchemas";

export const FALLBACK_QUESTIONS_BY_REASON = {
  wrong_size: {
    questionType: "size_preference",
    question:
      "Would a different size work for you, or would you prefer another option?",
    confidence: 0.85,
  },
  damaged_item: {
    questionType: "damage_details",
    question:
      "Could you briefly describe the damage and share a photo if you have one?",
    confidence: 0.85,
  },
  changed_mind: {
    questionType: "preference_reason",
    question:
      "What would work best for you instead — an exchange, store credit, or something else?",
    confidence: 0.8,
  },
  late_delivery: {
    questionType: "fulfillment_details",
    question:
      "When did the item arrive, and was it needed by a particular date?",
    confidence: 0.75,
  },
  wrong_item: {
    questionType: "wrong_item_details",
    question:
      "Could you describe what you received compared to what you ordered?",
    confidence: 0.85,
  },
  other: {
    questionType: "clarify_reason",
    question: "Could you tell us a bit more about the issue with your item?",
    confidence: 0.7,
  },
};

export const FALLBACK_QUESTIONS_BY_FOLLOW_UP_TYPE = {
  size_preference: FALLBACK_QUESTIONS_BY_REASON.wrong_size,
  size_or_comfort_preference: {
    questionType: "size_or_comfort_preference",
    question:
      "Would a different size or fit work better, or is comfort the main concern?",
    confidence: 0.85,
  },
  dimension_preference: {
    questionType: "dimension_preference",
    question:
      "Could you share the space or dimensions you need this item to fit?",
    confidence: 0.85,
  },
  damage_details: FALLBACK_QUESTIONS_BY_REASON.damaged_item,
  fault_details: {
    questionType: "fault_details",
    question:
      "Could you describe what is not working and when you first noticed it?",
    confidence: 0.85,
  },
  preference_reason: FALLBACK_QUESTIONS_BY_REASON.changed_mind,
  clarify_reason: FALLBACK_QUESTIONS_BY_REASON.other,
  wrong_item_details: FALLBACK_QUESTIONS_BY_REASON.wrong_item,
  fulfillment_details: FALLBACK_QUESTIONS_BY_REASON.late_delivery,
  safety_details: {
    questionType: "safety_details",
    question:
      "Could you share a few more details about the reaction or issue you experienced?",
    confidence: 0.8,
  },
  authenticity_details: {
    questionType: "authenticity_details",
    question:
      "Could you describe what made the item seem different from what you expected?",
    confidence: 0.8,
  },
  missing_parts_details: {
    questionType: "missing_parts_details",
    question: "Could you list which parts or accessories appear to be missing?",
    confidence: 0.85,
  },
  description_mismatch_details: {
    questionType: "description_mismatch_details",
    question:
      "Could you describe how the item differs from the listing or photos?",
    confidence: 0.85,
  },
  quality_details: {
    questionType: "quality_details",
    question:
      "Could you share a bit more detail about the quality issue you noticed?",
    confidence: 0.8,
  },
};

/**
 * Resolve a fallback follow-up question for a reason code and optional follow-up type.
 * @param {{
 *   reasonCode?: string | null;
 *   followUpType?: string | null;
 * }} input
 */
export function resolveFallbackFollowUpQuestion({
  reasonCode = "other",
  followUpType = null,
} = {}) {
  const normalizedReason = normalizeFollowUpReasonCode(reasonCode);
  const normalizedFollowUpType = normalizeFollowUpQuestionType(followUpType);

  if (
    normalizedFollowUpType &&
    FALLBACK_QUESTIONS_BY_FOLLOW_UP_TYPE[normalizedFollowUpType]
  ) {
    return {
      ...FALLBACK_QUESTIONS_BY_FOLLOW_UP_TYPE[normalizedFollowUpType],
      reasonCode: normalizedReason,
    };
  }

  const fallback =
    FALLBACK_QUESTIONS_BY_REASON[normalizedReason] ??
    FALLBACK_QUESTIONS_BY_REASON.other;

  return {
    ...fallback,
    reasonCode: normalizedReason,
  };
}

/**
 * @param {string} reasonCode
 */
export function isSupportedFollowUpReasonCode(reasonCode) {
  return FOLLOW_UP_REASON_CODES.includes(
    normalizeFollowUpReasonCode(reasonCode),
  );
}
