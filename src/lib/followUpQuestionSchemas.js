/**
 * Follow-up Question Engine schemas (Task 35 — Prompt 1).
 * Pure constants and normalizers — no LLM, Prisma, or network calls.
 */

export const FOLLOW_UP_REASON_CODES = [
  "wrong_size",
  "damaged_item",
  "changed_mind",
  "late_delivery",
  "wrong_item",
  "other",
];

export const FOLLOW_UP_QUESTION_TYPES = [
  "size_preference",
  "size_or_comfort_preference",
  "dimension_preference",
  "damage_details",
  "fault_details",
  "preference_reason",
  "clarify_reason",
  "wrong_item_details",
  "fulfillment_details",
  "safety_details",
  "authenticity_details",
  "missing_parts_details",
  "description_mismatch_details",
  "quality_details",
];

export const FOLLOW_UP_SOURCES = {
  FALLBACK: "fallback",
  REASON_INTELLIGENCE: "reason_intelligence",
  NONE: "none",
};

export const FOLLOW_UP_BLOCKED_REASONS = {
  LEGAL_REVIEW_REQUIRED: "LEGAL_REVIEW_REQUIRED",
  MANUAL_REVIEW: "manual_review",
  HARD_BLOCKED: "hard_blocked",
  CONSUMER_LAW_RISK: "consumer_law_risk",
  SAFETY_VALIDATION_FAILED: "safety_validation_failed",
  FOLLOW_UP_NOT_NEEDED: "follow_up_not_needed",
  SUFFICIENT_DETAIL_PROVIDED: "sufficient_detail_provided",
};

const REASON_CODE_ALIASES = {
  wrong_size: "wrong_size",
  wrongsize: "wrong_size",
  wrong_fit: "wrong_size",
  damaged_item: "damaged_item",
  damaged: "damaged_item",
  defective: "damaged_item",
  faulty: "damaged_item",
  changed_mind: "changed_mind",
  changedmind: "changed_mind",
  late_delivery: "late_delivery",
  latedelivery: "late_delivery",
  wrong_item: "wrong_item",
  wrongitem: "wrong_item",
  wrong_color: "wrong_item",
  quality_issue: "damaged_item",
  other: "other",
};

const MANUAL_REVIEW_TOKENS = new Set([
  "MANUAL_REVIEW",
  "manual_review",
  "MANUAL REVIEW",
  "LEGAL_REVIEW_REQUIRED",
  "LEGAL REVIEW REQUIRED",
]);

const HARD_BLOCKED_TOKENS = new Set([
  "hard_blocked",
  "HARD_BLOCKED",
  "blocked",
  "product_excluded",
  "PRODUCT_EXCLUDED",
  "no_safe_option",
  "NO_SAFE_OPTION",
]);

const CONSUMER_LAW_TOKENS = new Set([
  "consumer_law_risk",
  "CONSUMER_LAW_RISK",
  "acl_refund_rights_may_apply",
  "ACL_REFUND_RIGHTS_MAY_APPLY",
]);

/**
 * @param {unknown} value
 */
export function normalizeFollowUpReasonCode(value) {
  if (value == null || value === "") {
    return "other";
  }

  const token = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const alias = REASON_CODE_ALIASES[token];
  if (alias) {
    return alias;
  }

  return FOLLOW_UP_REASON_CODES.includes(token) ? token : "other";
}

/**
 * @param {unknown} value
 */
export function normalizeFollowUpQuestionType(value) {
  if (value == null || value === "") {
    return null;
  }

  const token = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return FOLLOW_UP_QUESTION_TYPES.includes(token) ? token : null;
}

/**
 * @param {unknown} value
 */
export function normalizeCommentText(value) {
  if (value == null) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

/**
 * Detect short-circuit blocked reason from pipeline/policy context.
 * @param {{
 *   policyStatus?: string | null;
 *   recommendedAction?: string | null;
 *   blockedReason?: string | null;
 *   legalFlags?: string[] | null;
 *   consumerLawRisk?: boolean | null;
 * }} input
 * @returns {string | null}
 */
export function detectFollowUpBlockedReason(input = {}) {
  const {
    policyStatus = null,
    recommendedAction = null,
    blockedReason = null,
    legalFlags = [],
    consumerLawRisk = false,
  } = input;

  const status = String(policyStatus ?? "").trim();
  const action = String(recommendedAction ?? "").trim();
  const blocked = String(blockedReason ?? "").trim();

  if (
    status === FOLLOW_UP_BLOCKED_REASONS.LEGAL_REVIEW_REQUIRED ||
    action === "LEGAL_REVIEW_REQUIRED" ||
    action === FOLLOW_UP_BLOCKED_REASONS.LEGAL_REVIEW_REQUIRED
  ) {
    return FOLLOW_UP_BLOCKED_REASONS.LEGAL_REVIEW_REQUIRED;
  }

  if (
    MANUAL_REVIEW_TOKENS.has(status) ||
    MANUAL_REVIEW_TOKENS.has(action) ||
    action === "MANUAL_REVIEW"
  ) {
    return FOLLOW_UP_BLOCKED_REASONS.MANUAL_REVIEW;
  }

  if (HARD_BLOCKED_TOKENS.has(blocked) || HARD_BLOCKED_TOKENS.has(status)) {
    return FOLLOW_UP_BLOCKED_REASONS.HARD_BLOCKED;
  }

  if (
    consumerLawRisk === true ||
    CONSUMER_LAW_TOKENS.has(blocked) ||
    (Array.isArray(legalFlags) &&
      legalFlags.some((flag) => CONSUMER_LAW_TOKENS.has(String(flag))))
  ) {
    return FOLLOW_UP_BLOCKED_REASONS.CONSUMER_LAW_RISK;
  }

  return null;
}

/**
 * @param {string | null | undefined} comment
 * @param {string} reasonCode
 */
export function hasSufficientCommentDetail(comment, reasonCode) {
  const normalized = normalizeCommentText(comment);
  if (normalized.length < 12) {
    return false;
  }

  const lower = normalized.toLowerCase();

  switch (reasonCode) {
    case "wrong_size":
      return /(too (small|big|large|tight|loose)|doesn'?t fit|wrong size|size \d|exchange for)/i.test(
        lower,
      );
    case "damaged_item":
      return /(photo|picture|image|crack|broken|tear|rip|dent|scratch|damage)/i.test(
        lower,
      );
    case "changed_mind":
      return /(prefer|would like|instead|store credit|exchange|keep|colour|color|style)/i.test(
        lower,
      );
    case "late_delivery":
      return /(late|delay|arrived|event|date|expected)/i.test(lower);
    case "wrong_item":
      return /(received|ordered|different|wrong item|not what)/i.test(lower);
    default:
      return normalized.length >= 24;
  }
}

/**
 * Build a no-follow-up result object.
 * @param {{
 *   reasonCode?: string;
 *   blockedReason?: string | null;
 *   confidence?: number;
 *   source?: string;
 * }} input
 */
export function buildNoFollowUpResult({
  reasonCode = "other",
  blockedReason = null,
  confidence = 0.9,
  source = FOLLOW_UP_SOURCES.NONE,
} = {}) {
  return {
    shouldAskFollowUp: false,
    question: null,
    questionType: null,
    reasonCode: normalizeFollowUpReasonCode(reasonCode),
    confidence,
    source,
    fallbackUsed: false,
    blockedReason,
  };
}
