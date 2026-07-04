/**
 * Follow-up question content safety (Task 35 — Prompt 1).
 * Validates customer-facing follow-up copy before use.
 */

export const FOLLOW_UP_SAFETY_VIOLATIONS = {
  REFUND_PROMISE: "refund_promise",
  APPROVAL_DECISION: "approval_decision",
  REJECTION_DECISION: "rejection_decision",
  INTERNAL_STRATEGY: "internal_strategy",
  BLAME_LANGUAGE: "blame_language",
  MULTIPLE_QUESTIONS: "multiple_questions",
  SENSITIVE_DATA_REQUEST: "sensitive_data_request",
  EMPTY_QUESTION: "empty_question",
};

const REFUND_PROMISE_PATTERNS = [
  /\b(you will|you'll|we will|we'll)\s+(get|receive|be given)\s+(a\s+)?refund\b/i,
  /\brefund\s+(is\s+)?(approved|guaranteed|confirmed)\b/i,
  /\bguaranteed\s+refund\b/i,
  /\bfull\s+refund\s+(approved|guaranteed)\b/i,
  /\bapprove(d)?\s+(your\s+)?refund\b/i,
];

const APPROVAL_PATTERNS = [
  /\b(your|the)\s+request\s+is\s+approved\b/i,
  /\bwe\s+approve\b/i,
  /\byou\s+are\s+approved\b/i,
  /\bapproved\s+for\s+(a\s+)?(refund|exchange|return)\b/i,
];

const REJECTION_PATTERNS = [
  /\b(your|the)\s+request\s+is\s+(rejected|denied)\b/i,
  /\bwe\s+(reject|deny)\b/i,
  /\bnot\s+eligible\s+for\s+(a\s+)?return\b/i,
  /\breturn\s+denied\b/i,
];

const INTERNAL_STRATEGY_PATTERNS = [
  /\brisk\s+score\b/i,
  /\brecovery\s+score\b/i,
  /\bmerchant\s+strategy\b/i,
  /\binternal\s+(note|code|enum|policy\s+code)\b/i,
  /\bconfidence\s+score\b/i,
  /\boffer\s+ladder\b/i,
  /\bmanual_review_or_/i,
  /\bPOLICY_[A-Z_]+\b/,
  /\bLEGAL_REVIEW_REQUIRED\b/,
];

const BLAME_PATTERNS = [
  /\byour\s+fault\b/i,
  /\byou\s+should\s+have\b/i,
  /\byou\s+failed\s+to\b/i,
  /\bbecause\s+of\s+you\b/i,
  /\byour\s+mistake\b/i,
  /\bnegligen(t|ce)\b/i,
];

const SENSITIVE_DATA_PATTERNS = [
  /\b(credit\s+card|card\s+number|cvv|cvc)\b/i,
  /\b(bank\s+account|bsb|routing\s+number)\b/i,
  /\b(passport|driver'?s?\s+licen[cs]e|medicare)\b/i,
  /\b(social\s+security|tax\s+file\s+number|ssn)\b/i,
  /\b(password|pin\s+code)\b/i,
];

function countQuestionMarks(text) {
  return (text.match(/\?/g) ?? []).length;
}

function findPatternViolations(text, patterns, violation) {
  const matches = [];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      matches.push(violation);
      break;
    }
  }
  return matches;
}

/**
 * Validate follow-up question content for customer-safe use.
 * @param {unknown} question
 * @returns {{
 *   safe: boolean;
 *   violations: string[];
 *   blockedReason: string | null;
 * }}
 */
export function validateFollowUpQuestionContent(question) {
  const text =
    question == null ? "" : String(question).replace(/\s+/g, " ").trim();

  if (!text) {
    return {
      safe: false,
      violations: [FOLLOW_UP_SAFETY_VIOLATIONS.EMPTY_QUESTION],
      blockedReason: FOLLOW_UP_SAFETY_VIOLATIONS.EMPTY_QUESTION,
    };
  }

  const violations = [];

  violations.push(
    ...findPatternViolations(
      text,
      REFUND_PROMISE_PATTERNS,
      FOLLOW_UP_SAFETY_VIOLATIONS.REFUND_PROMISE,
    ),
  );
  violations.push(
    ...findPatternViolations(
      text,
      APPROVAL_PATTERNS,
      FOLLOW_UP_SAFETY_VIOLATIONS.APPROVAL_DECISION,
    ),
  );
  violations.push(
    ...findPatternViolations(
      text,
      REJECTION_PATTERNS,
      FOLLOW_UP_SAFETY_VIOLATIONS.REJECTION_DECISION,
    ),
  );
  violations.push(
    ...findPatternViolations(
      text,
      INTERNAL_STRATEGY_PATTERNS,
      FOLLOW_UP_SAFETY_VIOLATIONS.INTERNAL_STRATEGY,
    ),
  );
  violations.push(
    ...findPatternViolations(
      text,
      BLAME_PATTERNS,
      FOLLOW_UP_SAFETY_VIOLATIONS.BLAME_LANGUAGE,
    ),
  );
  violations.push(
    ...findPatternViolations(
      text,
      SENSITIVE_DATA_PATTERNS,
      FOLLOW_UP_SAFETY_VIOLATIONS.SENSITIVE_DATA_REQUEST,
    ),
  );

  if (countQuestionMarks(text) > 1) {
    violations.push(FOLLOW_UP_SAFETY_VIOLATIONS.MULTIPLE_QUESTIONS);
  }

  const uniqueViolations = [...new Set(violations)];

  return {
    safe: uniqueViolations.length === 0,
    violations: uniqueViolations,
    blockedReason: uniqueViolations.length > 0 ? uniqueViolations[0] : null,
  };
}

/**
 * Sanitize or reject a follow-up question. Returns null when unsafe.
 * @param {unknown} question
 */
export function sanitizeFollowUpQuestion(question) {
  const validation = validateFollowUpQuestionContent(question);
  if (!validation.safe) {
    return null;
  }

  return String(question).replace(/\s+/g, " ").trim();
}
