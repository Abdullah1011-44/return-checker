import {
  POLICY_DECISIONS,
  POLICY_GUARDRAILS,
  POLICY_REASONS,
} from "@/lib/returnPolicyEngine";

export const AI_GUARDRAIL_FLAGS = {
  AUTO_REFUND_BLOCKED: "AUTO_REFUND_BLOCKED",
  POLICY_OVERRIDE_BLOCKED: "POLICY_OVERRIDE_BLOCKED",
  UNSAFE_PROMISE_BLOCKED: "UNSAFE_PROMISE_BLOCKED",
  HIGH_RISK_REQUIRES_REVIEW: "HIGH_RISK_REQUIRES_REVIEW",
  PARTIAL_REFUND_LIMIT_REQUIRED: "PARTIAL_REFUND_LIMIT_REQUIRED",
  CUSTOMER_PII_PROTECTION: "CUSTOMER_PII_PROTECTION",
  MANUAL_REVIEW_REQUIRED: "MANUAL_REVIEW_REQUIRED",
  LEGAL_REVIEW_REQUIRED: "LEGAL_REVIEW_REQUIRED",
  INTERNAL_CODE_LEAK_BLOCKED: "INTERNAL_CODE_LEAK_BLOCKED",
};

const UNSAFE_DECISIONS = new Set([
  "REFUND",
  "FULL_REFUND",
  "AUTO_REFUND",
  "APPROVE_REFUND",
]);

const SAFE_POLICY_DECISIONS = new Set(Object.values(POLICY_DECISIONS));

const RAW_INTERNAL_CODES = new Set([
  ...Object.values(POLICY_REASONS),
  ...Object.values(POLICY_GUARDRAILS),
  "RULE_MATCHED",
  "DEFAULT_RECOVERY_PATH",
  "NO_SAFE_OPTION",
]);

const RISKY_PROMISE_PATTERNS = [
  /guaranteed refund/i,
  /approved refund/i,
  /instant refund/i,
  /automatic refund/i,
  /you will get a refund/i,
  /refund approved/i,
  /refund is approved/i,
  /definitely entitled to a refund/i,
  /you are approved/i,
  /request is approved/i,
];

const GENERAL_SYSTEM_RULES = [
  "AI cannot approve refunds.",
  "AI cannot promise the customer a refund, exchange, store credit, or partial refund unless the deterministic policy result allows it.",
  "AI cannot override merchant settings.",
  "AI cannot override the deterministic policy result.",
  "AI cannot mention internal risk score to the customer.",
  "AI cannot expose merchant notes to the customer.",
  "AI cannot ask for unnecessary protected customer data.",
  "AI must use customer-friendly language.",
  "AI must not expose raw internal enum or code values.",
];

const SAFE_FALLBACK_MESSAGES = {
  [POLICY_DECISIONS.MANUAL_REVIEW]:
    "Thanks for sharing the details. Your request will be reviewed by the merchant team before a final outcome is confirmed.",
  [POLICY_DECISIONS.REJECT]:
    "Thanks for submitting your request. Based on the available information, it does not appear to meet the store’s standard return policy.",
  [POLICY_DECISIONS.EXCHANGE]:
    "Your request may be eligible for an exchange based on the store’s return policy.",
  [POLICY_DECISIONS.STORE_CREDIT]:
    "Your request may be eligible for store credit based on the store’s return policy.",
  [POLICY_DECISIONS.PARTIAL_REFUND]:
    "Your request may be eligible for a partial refund option based on the store’s return policy. The merchant team will confirm the final outcome.",
  ACL_REVIEW:
    "Thanks for sharing the issue. Because this may involve a faulty, damaged, or not-as-described product, your request will be reviewed by the merchant team under the applicable return policy and consumer-law obligations.",
};

function asStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string")
    : [];
}

function normalizeDecision(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  return String(value).trim().toUpperCase();
}

function normalizePolicyResult(policyResult) {
  if (!policyResult || typeof policyResult !== "object") {
    return {
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      reason: "",
      secondaryReasons: [],
      legalFlags: [],
      allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
      blockedOptions: [],
      guardrails: [],
      customerMessage: "",
      merchantNote: "",
    };
  }

  const decision = SAFE_POLICY_DECISIONS.has(
    normalizeDecision(policyResult.decision),
  )
    ? normalizeDecision(policyResult.decision)
    : POLICY_DECISIONS.MANUAL_REVIEW;

  return {
    decision,
    reason: typeof policyResult.reason === "string" ? policyResult.reason : "",
    secondaryReasons: asStringArray(policyResult.secondaryReasons),
    legalFlags: asStringArray(policyResult.legalFlags),
    allowedOptions: asStringArray(policyResult.allowedOptions),
    blockedOptions: asStringArray(policyResult.blockedOptions),
    guardrails: asStringArray(policyResult.guardrails),
    customerMessage:
      typeof policyResult.customerMessage === "string"
        ? policyResult.customerMessage
        : "",
    merchantNote:
      typeof policyResult.merchantNote === "string"
        ? policyResult.merchantNote
        : "",
    maxRefundPercent: Number.isFinite(Number(policyResult.maxRefundPercent))
      ? Number(policyResult.maxRefundPercent)
      : null,
  };
}

function hasAclLegalReview(policyResult) {
  return policyResult.legalFlags.includes(
    POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
  );
}

function buildAllowedDecisions(policyResult) {
  const allowed = new Set();

  if (SAFE_POLICY_DECISIONS.has(policyResult.decision)) {
    allowed.add(policyResult.decision);
  }

  for (const option of policyResult.allowedOptions) {
    const normalized = normalizeDecision(option);
    if (
      SAFE_POLICY_DECISIONS.has(normalized) &&
      !UNSAFE_DECISIONS.has(normalized)
    ) {
      allowed.add(normalized);
    }
  }

  return [...allowed];
}

function buildBlockedDecisions(policyResult, allowedDecisions) {
  const allowedSet = new Set(allowedDecisions);
  const blocked = new Set(UNSAFE_DECISIONS);

  for (const option of policyResult.blockedOptions) {
    const normalized = normalizeDecision(option);
    if (normalized) {
      blocked.add(normalized);
    }
  }

  for (const decision of SAFE_POLICY_DECISIONS) {
    if (!allowedSet.has(decision)) {
      blocked.add(decision);
    }
  }

  for (const unsafe of UNSAFE_DECISIONS) {
    blocked.add(unsafe);
  }

  return [...blocked];
}

function buildMustNotInclude(policyResult) {
  const mustNotInclude = [
    ...RAW_INTERNAL_CODES,
    ...policyResult.secondaryReasons,
    ...policyResult.legalFlags,
    ...policyResult.guardrails,
    policyResult.reason,
    "guaranteed refund",
    "approved refund",
    "instant refund",
    "automatic refund",
    "you will get a refund",
    "refund approved",
    "definitely entitled to a refund",
  ].filter(Boolean);

  if (hasAclLegalReview(policyResult)) {
    mustNotInclude.push(
      POLICY_DECISIONS.REJECT,
      "REFUND",
      "FULL_REFUND",
      "AUTO_REFUND",
      "APPROVE_REFUND",
      "your refund is approved",
      "you are definitely entitled",
    );
  }

  return [...new Set(mustNotInclude)];
}

/**
 * @param {Record<string, unknown> | null | undefined} policyResult
 */
export function buildAIGuardrailContext(policyResult) {
  const normalized = normalizePolicyResult(policyResult);
  const allowedDecisions = buildAllowedDecisions(normalized);
  const blockedDecisions = buildBlockedDecisions(normalized, allowedDecisions);

  const systemRules = [...GENERAL_SYSTEM_RULES];
  const mustInclude = [];
  const mustNotInclude = buildMustNotInclude(normalized);
  const flags = [AI_GUARDRAIL_FLAGS.CUSTOMER_PII_PROTECTION];

  if (normalized.guardrails.includes(POLICY_GUARDRAILS.NO_AUTO_REFUND)) {
    flags.push(AI_GUARDRAIL_FLAGS.AUTO_REFUND_BLOCKED);
  }

  if (
    normalized.guardrails.includes(POLICY_GUARDRAILS.AI_CANNOT_OVERRIDE_POLICY)
  ) {
    flags.push(AI_GUARDRAIL_FLAGS.POLICY_OVERRIDE_BLOCKED);
  }

  if (
    normalized.guardrails.includes(
      POLICY_GUARDRAILS.HIGH_RISK_REQUIRES_REVIEW,
    ) ||
    normalized.secondaryReasons.includes(POLICY_REASONS.HIGH_RISK_REQUEST)
  ) {
    flags.push(AI_GUARDRAIL_FLAGS.HIGH_RISK_REQUIRES_REVIEW);
    mustInclude.push(
      "Explain that the merchant team will review the request because of elevated risk signals.",
    );
  }

  if (normalized.decision === POLICY_DECISIONS.MANUAL_REVIEW) {
    flags.push(AI_GUARDRAIL_FLAGS.MANUAL_REVIEW_REQUIRED);
    mustInclude.push(
      "State clearly that the request will be reviewed by the merchant team before a final outcome is confirmed.",
    );
    mustNotInclude.push(
      "you are approved",
      "request is approved",
      "guaranteed refund",
    );
  }

  if (normalized.decision === POLICY_DECISIONS.REJECT) {
    mustInclude.push(
      "Politely explain that the request does not appear to meet the store's standard return policy.",
    );

    if (hasAclLegalReview(normalized)) {
      mustNotInclude.push(POLICY_DECISIONS.REJECT);
      mustInclude.push(
        "Do not reject the request when consumer-law review may apply.",
      );
    }
  }

  if (normalized.decision === POLICY_DECISIONS.PARTIAL_REFUND) {
    flags.push(AI_GUARDRAIL_FLAGS.PARTIAL_REFUND_LIMIT_REQUIRED);
    mustInclude.push(
      "Describe partial refund as a policy-based option that requires merchant review, not an automatic approval.",
    );
    mustNotInclude.push(
      "automatic refund",
      "refund is approved",
      "approved automatically",
    );

    if (normalized.maxRefundPercent == null) {
      mustNotInclude.push("%", "percent refund", "percentage refund");
    }
  }

  if (hasAclLegalReview(normalized)) {
    flags.push(AI_GUARDRAIL_FLAGS.LEGAL_REVIEW_REQUIRED);
    mustInclude.push(
      "Say the request needs merchant review because consumer-law rights may apply.",
      SAFE_FALLBACK_MESSAGES.ACL_REVIEW,
    );
    mustNotInclude.push(
      POLICY_DECISIONS.REJECT,
      "REFUND",
      "FULL_REFUND",
      "AUTO_REFUND",
      "APPROVE_REFUND",
      "refund is approved",
      "definitely entitled to a refund",
      POLICY_GUARDRAILS.MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW,
      POLICY_GUARDRAILS.AI_CANNOT_PROMISE_REFUND,
    );
    systemRules.push(
      "Merchant settings cannot override consumer-law review language.",
    );
  }

  flags.push(AI_GUARDRAIL_FLAGS.UNSAFE_PROMISE_BLOCKED);
  flags.push(AI_GUARDRAIL_FLAGS.INTERNAL_CODE_LEAK_BLOCKED);

  return {
    systemRules,
    allowedDecisions,
    blockedDecisions,
    mustInclude: [...new Set(mustInclude)],
    mustNotInclude: [...new Set(mustNotInclude)],
    flags: [...new Set(flags)],
  };
}

function resolveSafeMessage(policyResult) {
  if (hasAclLegalReview(policyResult)) {
    return SAFE_FALLBACK_MESSAGES.ACL_REVIEW;
  }

  if (
    policyResult.customerMessage &&
    !containsRawInternalCode(policyResult.customerMessage, policyResult)
  ) {
    return policyResult.customerMessage;
  }

  return (
    SAFE_FALLBACK_MESSAGES[policyResult.decision] ??
    SAFE_FALLBACK_MESSAGES[POLICY_DECISIONS.MANUAL_REVIEW]
  );
}

function containsRawInternalCode(message, policyResult) {
  if (typeof message !== "string" || !message.trim()) {
    return false;
  }

  const haystack = message.toUpperCase();

  for (const code of RAW_INTERNAL_CODES) {
    if (haystack.includes(String(code).toUpperCase())) {
      return true;
    }
  }

  for (const code of policyResult.secondaryReasons) {
    if (haystack.includes(String(code).toUpperCase())) {
      return true;
    }
  }

  for (const code of policyResult.legalFlags) {
    if (haystack.includes(String(code).toUpperCase())) {
      return true;
    }
  }

  for (const code of policyResult.guardrails) {
    if (haystack.includes(String(code).toUpperCase())) {
      return true;
    }
  }

  if (
    policyResult.reason &&
    haystack.includes(policyResult.reason.toUpperCase())
  ) {
    return true;
  }

  return false;
}

function containsRiskyPromise(message) {
  if (typeof message !== "string" || !message.trim()) {
    return false;
  }

  return RISKY_PROMISE_PATTERNS.some((pattern) => pattern.test(message));
}

function normalizeAiRecommendation(aiRecommendation) {
  if (!aiRecommendation || typeof aiRecommendation !== "object") {
    return {
      decision: "",
      message: "",
    };
  }

  return {
    decision: normalizeDecision(aiRecommendation.decision),
    message:
      typeof aiRecommendation.message === "string"
        ? aiRecommendation.message
        : typeof aiRecommendation.customerMessage === "string"
          ? aiRecommendation.customerMessage
          : "",
  };
}

/**
 * @param {{
 *   policyResult?: Record<string, unknown> | null;
 *   aiRecommendation?: Record<string, unknown> | null;
 * }} input
 */
export function validateAIRecommendation({ policyResult, aiRecommendation }) {
  const normalizedPolicy = normalizePolicyResult(policyResult);
  const normalizedAi = normalizeAiRecommendation(aiRecommendation);
  const context = buildAIGuardrailContext(normalizedPolicy);
  const violations = [];

  const safeDecision = normalizedPolicy.decision;
  let safeMessage = resolveSafeMessage(normalizedPolicy);

  if (!aiRecommendation || typeof aiRecommendation !== "object") {
    violations.push(AI_GUARDRAIL_FLAGS.POLICY_OVERRIDE_BLOCKED);
    return {
      isValid: false,
      violations,
      safeDecision,
      safeMessage,
    };
  }

  if (!normalizedAi.decision) {
    violations.push(AI_GUARDRAIL_FLAGS.POLICY_OVERRIDE_BLOCKED);
  }

  if (UNSAFE_DECISIONS.has(normalizedAi.decision)) {
    violations.push(AI_GUARDRAIL_FLAGS.AUTO_REFUND_BLOCKED);
  }

  const policyDecision = normalizedPolicy.decision;
  const allowedDecisions = new Set(context.allowedDecisions);

  if (
    normalizedAi.decision &&
    normalizedAi.decision !== policyDecision &&
    !allowedDecisions.has(normalizedAi.decision)
  ) {
    violations.push(AI_GUARDRAIL_FLAGS.POLICY_OVERRIDE_BLOCKED);
  }

  if (
    policyDecision === POLICY_DECISIONS.MANUAL_REVIEW &&
    normalizedAi.decision &&
    normalizedAi.decision !== POLICY_DECISIONS.MANUAL_REVIEW
  ) {
    violations.push(AI_GUARDRAIL_FLAGS.MANUAL_REVIEW_REQUIRED);
  }

  if (
    policyDecision === POLICY_DECISIONS.REJECT &&
    normalizedAi.decision &&
    normalizedAi.decision !== POLICY_DECISIONS.REJECT
  ) {
    violations.push(AI_GUARDRAIL_FLAGS.POLICY_OVERRIDE_BLOCKED);
  }

  if (hasAclLegalReview(normalizedPolicy)) {
    const disallowedForAcl = new Set([
      POLICY_DECISIONS.REJECT,
      "REFUND",
      "FULL_REFUND",
      "AUTO_REFUND",
      "APPROVE_REFUND",
    ]);

    if (disallowedForAcl.has(normalizedAi.decision)) {
      violations.push(AI_GUARDRAIL_FLAGS.LEGAL_REVIEW_REQUIRED);
    }
  }

  if (containsRiskyPromise(normalizedAi.message)) {
    violations.push(AI_GUARDRAIL_FLAGS.UNSAFE_PROMISE_BLOCKED);
  }

  if (containsRawInternalCode(normalizedAi.message, normalizedPolicy)) {
    violations.push(AI_GUARDRAIL_FLAGS.INTERNAL_CODE_LEAK_BLOCKED);
  }

  if (
    policyDecision === POLICY_DECISIONS.PARTIAL_REFUND &&
    normalizedPolicy.maxRefundPercent == null &&
    /%|\bpercent\b/i.test(normalizedAi.message)
  ) {
    violations.push(AI_GUARDRAIL_FLAGS.PARTIAL_REFUND_LIMIT_REQUIRED);
  }

  const isValid = violations.length === 0;

  if (!isValid) {
    safeMessage = resolveSafeMessage(normalizedPolicy);
  } else if (
    normalizedAi.message &&
    !containsRawInternalCode(normalizedAi.message, normalizedPolicy)
  ) {
    safeMessage = normalizedAi.message;
  }

  return {
    isValid,
    violations: [...new Set(violations)],
    safeDecision,
    safeMessage,
  };
}
