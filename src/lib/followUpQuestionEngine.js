/**
 * Follow-up Question Engine (Task 35 — Prompt 1).
 * Fallback-first, deterministic — no LLM, Prisma, or network calls.
 */
import { resolveFallbackFollowUpQuestion } from "@/lib/followUpQuestionPrompts";
import { validateFollowUpQuestionContent } from "@/lib/followUpQuestionSafety";
import {
  buildNoFollowUpResult,
  detectFollowUpBlockedReason,
  FOLLOW_UP_BLOCKED_REASONS,
  FOLLOW_UP_SOURCES,
  hasSufficientCommentDetail,
  normalizeCommentText,
  normalizeFollowUpReasonCode,
} from "@/lib/followUpQuestionSchemas";

function resolveReasonCode(input) {
  const reasonIntelligence = input.reasonIntelligence;

  if (reasonIntelligence?.normalizedReason) {
    return normalizeFollowUpReasonCode(reasonIntelligence.normalizedReason);
  }

  if (input.reasonCode) {
    return normalizeFollowUpReasonCode(input.reasonCode);
  }

  if (input.reason) {
    return normalizeFollowUpReasonCode(input.reason);
  }

  return "other";
}

function resolveFollowUpType(input, reasonCode) {
  const reasonIntelligence = input.reasonIntelligence;

  if (reasonIntelligence?.followUpType) {
    return reasonIntelligence.followUpType;
  }

  if (input.followUpType) {
    return input.followUpType;
  }

  const fallback = resolveFallbackFollowUpQuestion({ reasonCode });
  return fallback.questionType;
}

function shouldSkipForFollowUpNeeded(input) {
  const reasonIntelligence = input.reasonIntelligence;

  if (reasonIntelligence?.followUpNeeded === false) {
    return true;
  }

  if (input.followUpNeeded === false) {
    return true;
  }

  return false;
}

function buildBlockedResult(reasonCode, blockedReason) {
  return buildNoFollowUpResult({
    reasonCode,
    blockedReason,
    confidence: 0.95,
    source: FOLLOW_UP_SOURCES.NONE,
  });
}

function buildFollowUpResult({
  question,
  questionType,
  reasonCode,
  confidence,
  fallbackUsed,
}) {
  const safety = validateFollowUpQuestionContent(question);

  if (!safety.safe) {
    return buildNoFollowUpResult({
      reasonCode,
      blockedReason: FOLLOW_UP_BLOCKED_REASONS.SAFETY_VALIDATION_FAILED,
      confidence: 0.95,
      source: FOLLOW_UP_SOURCES.NONE,
    });
  }

  return {
    shouldAskFollowUp: true,
    question,
    questionType,
    reasonCode,
    confidence,
    source: fallbackUsed
      ? FOLLOW_UP_SOURCES.FALLBACK
      : FOLLOW_UP_SOURCES.REASON_INTELLIGENCE,
    fallbackUsed,
    blockedReason: null,
  };
}

/**
 * Evaluate whether a customer follow-up question should be asked.
 *
 * @param {{
 *   reason?: string | null;
 *   reasonCode?: string | null;
 *   comment?: string | null;
 *   followUpType?: string | null;
 *   followUpNeeded?: boolean | null;
 *   reasonIntelligence?: Record<string, unknown> | null;
 *   policyStatus?: string | null;
 *   recommendedAction?: string | null;
 *   blockedReason?: string | null;
 *   legalFlags?: string[] | null;
 *   consumerLawRisk?: boolean | null;
 * }} input
 */
export function evaluateFollowUpQuestion(input = {}) {
  const reasonCode = resolveReasonCode(input);
  const comment = normalizeCommentText(input.comment);

  const pipelineBlocked = detectFollowUpBlockedReason({
    policyStatus: input.policyStatus,
    recommendedAction: input.recommendedAction,
    blockedReason: input.blockedReason,
    legalFlags: input.legalFlags,
    consumerLawRisk: input.consumerLawRisk,
  });

  if (pipelineBlocked) {
    return buildBlockedResult(reasonCode, pipelineBlocked);
  }

  if (shouldSkipForFollowUpNeeded(input)) {
    return buildNoFollowUpResult({
      reasonCode,
      blockedReason: FOLLOW_UP_BLOCKED_REASONS.FOLLOW_UP_NOT_NEEDED,
      confidence: 0.9,
    });
  }

  if (hasSufficientCommentDetail(comment, reasonCode)) {
    return buildNoFollowUpResult({
      reasonCode,
      blockedReason: FOLLOW_UP_BLOCKED_REASONS.SUFFICIENT_DETAIL_PROVIDED,
      confidence: 0.85,
    });
  }

  const followUpType = resolveFollowUpType(input, reasonCode);
  const fallback = resolveFallbackFollowUpQuestion({
    reasonCode,
    followUpType,
  });

  return buildFollowUpResult({
    question: fallback.question,
    questionType: fallback.questionType,
    reasonCode: fallback.reasonCode,
    confidence: fallback.confidence,
    fallbackUsed: true,
  });
}
