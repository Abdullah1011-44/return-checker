/**
 * Deterministic return policy engine (Task 31 + Task 32).
 * Pure evaluation only — no Prisma, fetch, env, logging, or side effects.
 * AI must not make the final decision.
 *
 * Recovery pipeline order (per item; see recoveryItemPipeline.js):
 *   Product Exclusion Check → Merchant Settings Gate → Recovery Rules
 *   → AI Guardrails / aiConfidenceThreshold → generateOfferLadder() → Final Decision
 *
 * Product exclusions are evaluated in productExclusion.js as a pre-flight
 * suppressor before generateOfferLadder(). They are not recovery offers.
 */

import {
  evaluateProductExclusion,
  findProductExclusionRule,
  getOfferLadderRules,
} from "@/lib/productExclusion";

export const POLICY_DECISIONS = {
  EXCHANGE: "EXCHANGE",
  STORE_CREDIT: "STORE_CREDIT",
  PARTIAL_REFUND: "PARTIAL_REFUND",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  REJECT: "REJECT",
};

export const POLICY_REASONS = {
  OUTSIDE_RETURN_WINDOW: "OUTSIDE_RETURN_WINDOW",
  MISSING_DELIVERED_AT: "MISSING_DELIVERED_AT",
  FINAL_SALE_ITEM: "FINAL_SALE_ITEM",
  NON_RETURNABLE_ITEM: "NON_RETURNABLE_ITEM",
  HIGH_RISK_REQUEST: "HIGH_RISK_REQUEST",
  DAMAGED_ITEM_REQUIRES_REVIEW: "DAMAGED_ITEM_REQUIRES_REVIEW",
  LEGAL_REVIEW_REQUIRED: "LEGAL_REVIEW_REQUIRED",
  ACL_REFUND_RIGHTS_MAY_APPLY: "ACL_REFUND_RIGHTS_MAY_APPLY",
  CONSUMER_LAW_OVERRIDE: "CONSUMER_LAW_OVERRIDE",
  SETTINGS_BLOCK_RULE_ACTION: "SETTINGS_BLOCK_RULE_ACTION",
  RULE_MATCHED: "RULE_MATCHED",
  DEFAULT_RECOVERY_PATH: "DEFAULT_RECOVERY_PATH",
  NO_MATCHING_RULE: "NO_MATCHING_RULE",
  NO_SAFE_OPTION: "NO_SAFE_OPTION",
  PRODUCT_EXCLUDED: "PRODUCT_EXCLUDED",
};

export const POLICY_GUARDRAILS = {
  NO_AUTO_REFUND: "NO_AUTO_REFUND",
  AI_CANNOT_OVERRIDE_POLICY: "AI_CANNOT_OVERRIDE_POLICY",
  MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW:
    "MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW",
  AI_CANNOT_PROMISE_REFUND: "AI_CANNOT_PROMISE_REFUND",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
  SETTINGS_OVERRIDE_RECOVERY_RULES: "SETTINGS_OVERRIDE_RECOVERY_RULES",
  HIGH_RISK_REQUIRES_REVIEW: "HIGH_RISK_REQUIRES_REVIEW",
};

const SAFE_DECISIONS = new Set(Object.values(POLICY_DECISIONS));

const UNSAFE_ACTIONS = new Set([
  "REFUND",
  "FULL_REFUND",
  "AUTO_REFUND",
  "APPROVE_REFUND",
]);

const BUYER_REMORSE_TOKENS = new Set([
  "CHANGED_MIND",
  "WRONG_SIZE",
  "WRONG_COLOR",
  "ORDERED_WRONG_SIZE",
  "TOO_SMALL",
  "TOO_LARGE",
  "DOES_NOT_FIT",
]);

const LEGAL_REVIEW_TOKENS = new Set([
  "FAULTY",
  "DEFECTIVE",
  "NOT_AS_DESCRIBED",
  "DAMAGED_ITEM",
  "MAJOR_FAILURE",
  "UNSAFE",
  "WRONG_ITEM",
  "MISSING_PARTS",
  "QUALITY_ISSUE",
  "ITEM_NOT_WORKING",
]);

const LEGAL_KEYWORD_FALLBACKS = [
  "faulty",
  "defective",
  "not as described",
  "not_as_described",
  "damaged item",
  "damaged_item",
  "major failure",
  "unsafe",
  "wrong item",
  "missing parts",
  "quality issue",
  "item not working",
  "does not work",
  "stopped working",
];

const DAMAGED_TOKENS = new Set(["DAMAGED_ITEM", "DAMAGED", "DAMAGED_ITEM"]);

const BASE_GUARDRAILS = [
  POLICY_GUARDRAILS.NO_AUTO_REFUND,
  POLICY_GUARDRAILS.AI_CANNOT_OVERRIDE_POLICY,
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeToken(value) {
  if (value == null) {
    return "";
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeUiReason(value) {
  const token = normalizeToken(value);
  if (!token) {
    return "";
  }

  const uiMap = {
    WRONG_SIZE: "WRONG_SIZE",
    WRONG_COLOR: "WRONG_COLOR",
    DAMAGED_ITEM: "DAMAGED_ITEM",
    WRONG_ITEM: "WRONG_ITEM",
    CHANGED_MIND: "CHANGED_MIND",
    QUALITY_ISSUE: "QUALITY_ISSUE",
    LATE_DELIVERY: "LATE_DELIVERY",
    OTHER: "OTHER",
  };

  if (uiMap[token]) {
    return uiMap[token];
  }

  const snake = token.toLowerCase();
  const reverse = {
    WRONG_SIZE: "wrong_size",
    WRONG_COLOR: "wrong_color",
    DAMAGED_ITEM: "damaged_item",
    WRONG_ITEM: "wrong_item",
    CHANGED_MIND: "changed_mind",
    QUALITY_ISSUE: "quality_issue",
    LATE_DELIVERY: "late_delivery",
    OTHER: "other",
  };

  for (const [prismaKey, uiKey] of Object.entries(reverse)) {
    if (snake === uiKey) {
      return prismaKey;
    }
  }

  return token;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeMerchantSettings(merchantSettings) {
  const settings = merchantSettings ?? {};

  const returnWindowDays =
    Number(settings.returnWindowDays ?? settings.returnWindow) || 30;

  return {
    returnWindowDays: returnWindowDays > 0 ? returnWindowDays : 30,
    allowExchanges: settings.allowExchanges ?? settings.allowExchange ?? true,
    allowStoreCredit: settings.allowStoreCredit ?? true,
    allowPartialRefunds:
      settings.allowPartialRefunds ?? settings.allowPartialRefund ?? false,
    allowManualReviewFallback: settings.allowManualReviewFallback ?? true,
  };
}

function collectStringFields(returnRequest, items) {
  const fields = [];

  const requestFields = [
    returnRequest?.reasonCategory,
    returnRequest?.reasonCode,
    returnRequest?.reason,
    returnRequest?.itemCondition,
    returnRequest?.customerClaimType,
    returnRequest?.issueType,
    returnRequest?.comment,
    returnRequest?.description,
    returnRequest?.customerNote,
  ];

  for (const value of requestFields) {
    if (typeof value === "string" && value.trim()) {
      fields.push(value);
    }
  }

  for (const item of items ?? []) {
    const itemFields = [
      item?.reason,
      item?.returnReason,
      item?.reasonCategory,
      item?.reasonCode,
      item?.comment,
      item?.description,
      item?.customerNote,
    ];

    for (const value of itemFields) {
      if (typeof value === "string" && value.trim()) {
        fields.push(value);
      }
    }
  }

  return fields;
}

function isBuyerRemorseToken(token) {
  return BUYER_REMORSE_TOKENS.has(token);
}

function tokenIndicatesLegalReview(token) {
  if (!token) {
    return false;
  }

  if (LEGAL_REVIEW_TOKENS.has(token)) {
    return true;
  }

  const lower = token.toLowerCase().replace(/_/g, " ");
  return LEGAL_KEYWORD_FALLBACKS.some((keyword) => lower.includes(keyword));
}

function detectLegalReviewSignals(returnRequest, items) {
  const structuredTokens = [];

  for (const field of collectStringFields(returnRequest, items)) {
    structuredTokens.push(normalizeToken(field));
    structuredTokens.push(normalizeUiReason(field));
  }

  const uniqueTokens = [...new Set(structuredTokens.filter(Boolean))];
  const hasBuyerRemorseOnly =
    uniqueTokens.length > 0 &&
    uniqueTokens.every((token) => isBuyerRemorseToken(token));

  for (const token of uniqueTokens) {
    if (isBuyerRemorseToken(token)) {
      continue;
    }

    if (tokenIndicatesLegalReview(token)) {
      return { triggered: true, usedKeywordFallback: false };
    }
  }

  if (hasBuyerRemorseOnly) {
    return { triggered: false, usedKeywordFallback: false };
  }

  const combinedText = collectStringFields(returnRequest, items)
    .join(" ")
    .toLowerCase();

  if (!combinedText.trim()) {
    return {
      triggered: false,
      usedKeywordFallback: false,
      insufficientInfo: true,
    };
  }

  const keywordHit = LEGAL_KEYWORD_FALLBACKS.some((keyword) =>
    combinedText.includes(keyword),
  );

  return {
    triggered: keywordHit,
    usedKeywordFallback: keywordHit,
    insufficientInfo: false,
  };
}

function getPrimaryReason(returnRequest, items) {
  const direct =
    returnRequest?.reason ??
    returnRequest?.reasonCode ??
    returnRequest?.reasonCategory;

  if (direct != null) {
    return normalizeUiReason(direct);
  }

  const itemList = Array.isArray(items) ? items : (returnRequest?.items ?? []);
  for (const item of itemList) {
    const reason = item?.reason ?? item?.returnReason;
    if (reason != null) {
      return normalizeUiReason(reason);
    }
  }

  return "";
}

function normalizeRiskLevel(value) {
  const token = normalizeToken(value);
  if (token === "HIGH") {
    return "HIGH";
  }
  if (token === "LOW") {
    return "LOW";
  }
  if (token === "MEDIUM") {
    return "MEDIUM";
  }
  return "";
}

function getAggregateRiskLevel(returnRequest, items) {
  const requestRisk = normalizeRiskLevel(returnRequest?.riskLevel);
  if (requestRisk === "HIGH") {
    return "HIGH";
  }

  const itemList = Array.isArray(items) ? items : (returnRequest?.items ?? []);
  let highest = requestRisk || "MEDIUM";

  for (const item of itemList) {
    const risk = normalizeRiskLevel(item?.riskLevel);
    if (risk === "HIGH") {
      return "HIGH";
    }
    if (risk === "MEDIUM" && highest !== "HIGH") {
      highest = "MEDIUM";
    }
    if (risk === "LOW" && !highest) {
      highest = "LOW";
    }
  }

  return highest || "MEDIUM";
}

function getDeliveredAt(returnRequest, order) {
  return (
    parseDate(order?.deliveredAt) ??
    parseDate(returnRequest?.deliveredAt) ??
    parseDate(order?.fulfilledAt) ??
    null
  );
}

function isOutsideReturnWindow({
  deliveredAt,
  returnWindowDays,
  windowExpiresAt,
  referenceDate = new Date(),
}) {
  const expiresAt = parseDate(windowExpiresAt);
  if (expiresAt && referenceDate > expiresAt) {
    return true;
  }

  if (!deliveredAt) {
    return null;
  }

  const elapsedDays = Math.floor(
    (referenceDate.getTime() - deliveredAt.getTime()) / MS_PER_DAY,
  );

  return elapsedDays > returnWindowDays;
}

function hasFinalSaleItem(items) {
  for (const item of items ?? []) {
    if (item?.finalSale === true || item?.isFinalSale === true) {
      return true;
    }

    const orderItem = item?.orderItem ?? item;
    if (orderItem?.finalSale === true || orderItem?.isFinalSale === true) {
      return true;
    }
  }

  return false;
}

function hasNonReturnableItem(items) {
  for (const item of items ?? []) {
    const orderItem = item?.orderItem ?? item;
    if (orderItem?.isReturnable === false) {
      return true;
    }
    if (item?.isReturnable === false) {
      return true;
    }
  }

  return false;
}

function isDamagedItemReason(reasonToken) {
  if (!reasonToken) {
    return false;
  }

  return (
    DAMAGED_TOKENS.has(reasonToken) ||
    reasonToken === "DAMAGED_ITEM" ||
    normalizeToken(reasonToken) === "DAMAGED_ITEM"
  );
}

function computeOptionAvailability(settings) {
  const allowedOptions = [];
  const blockedOptions = [];

  if (settings.allowExchanges) {
    allowedOptions.push(POLICY_DECISIONS.EXCHANGE);
  } else {
    blockedOptions.push(POLICY_DECISIONS.EXCHANGE);
  }

  if (settings.allowStoreCredit) {
    allowedOptions.push(POLICY_DECISIONS.STORE_CREDIT);
  } else {
    blockedOptions.push(POLICY_DECISIONS.STORE_CREDIT);
  }

  if (settings.allowPartialRefunds) {
    allowedOptions.push(POLICY_DECISIONS.PARTIAL_REFUND);
  } else {
    blockedOptions.push(POLICY_DECISIONS.PARTIAL_REFUND);
  }

  if (settings.allowManualReviewFallback) {
    allowedOptions.push(POLICY_DECISIONS.MANUAL_REVIEW);
  }

  return { allowedOptions, blockedOptions };
}

function isDecisionAllowed(decision, settings) {
  if (decision === POLICY_DECISIONS.MANUAL_REVIEW) {
    return settings.allowManualReviewFallback;
  }

  if (decision === POLICY_DECISIONS.REJECT) {
    return true;
  }

  if (decision === POLICY_DECISIONS.EXCHANGE) {
    return settings.allowExchanges;
  }

  if (decision === POLICY_DECISIONS.STORE_CREDIT) {
    return settings.allowStoreCredit;
  }

  if (decision === POLICY_DECISIONS.PARTIAL_REFUND) {
    return settings.allowPartialRefunds;
  }

  return false;
}

function safeMapRuleAction(rule) {
  const rawAction = rule?.action ?? rule?.type ?? "";
  const token = normalizeToken(rawAction);

  if (UNSAFE_ACTIONS.has(token)) {
    return {
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      unsafe: true,
    };
  }

  if (SAFE_DECISIONS.has(token)) {
    return { decision: token, unsafe: false };
  }

  return {
    decision: POLICY_DECISIONS.MANUAL_REVIEW,
    unsafe: true,
  };
}

function reasonMatches(ruleReason, requestReason) {
  const ruleToken = normalizeToken(ruleReason);
  const requestToken = normalizeUiReason(requestReason);

  if (!ruleToken || ruleToken === "ANY") {
    return true;
  }

  return (
    ruleToken === requestToken || normalizeUiReason(ruleReason) === requestToken
  );
}

function riskMatches(ruleRisk, requestRisk) {
  const ruleToken = normalizeRiskLevel(ruleRisk);
  const requestToken = normalizeRiskLevel(requestRisk);

  if (!ruleToken || ruleToken === "ANY") {
    return true;
  }

  return ruleToken === requestToken;
}

function isRuleEnabled(rule) {
  if (!rule || typeof rule !== "object") {
    return false;
  }

  if (rule.enabled === false || rule.isEnabled === false) {
    return false;
  }

  return true;
}

function getRulePriority(rule) {
  const priority = Number(rule?.priority);
  return Number.isFinite(priority) ? priority : 999;
}

function getOrderTotal(order, returnRequest) {
  const raw =
    order?.totalAmount ??
    returnRequest?.orderTotal ??
    returnRequest?.totalAmount;

  if (raw == null) {
    return null;
  }

  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

function ruleMatchesRequest(rule, context) {
  if (!isRuleEnabled(rule)) {
    return false;
  }

  const conditions =
    rule?.conditions && typeof rule.conditions === "object"
      ? rule.conditions
      : {};

  const ruleReason =
    rule?.reason ??
    rule?.reasonCategory ??
    conditions.reason ??
    conditions.reasonCategory;
  const ruleRisk = rule?.riskLevel ?? conditions.riskLevel;

  if (!reasonMatches(ruleReason, context.primaryReason)) {
    return false;
  }

  if (!riskMatches(ruleRisk, context.riskLevel)) {
    return false;
  }

  if (
    conditions.minOrderValue != null &&
    context.orderTotal != null &&
    context.orderTotal < Number(conditions.minOrderValue)
  ) {
    return false;
  }

  if (
    conditions.maxOrderValue != null &&
    context.orderTotal != null &&
    context.orderTotal > Number(conditions.maxOrderValue)
  ) {
    return false;
  }

  return true;
}

function findMatchingRule(recoveryRules, context) {
  const rules = getOfferLadderRules(
    Array.isArray(recoveryRules) ? recoveryRules : [],
  );
  const enabledRules = rules
    .filter(isRuleEnabled)
    .sort((left, right) => getRulePriority(left) - getRulePriority(right));

  for (const rule of enabledRules) {
    if (ruleMatchesRequest(rule, context)) {
      return rule;
    }
  }

  return null;
}

function chooseDefaultRecoveryPath(settings, allowedOptions) {
  const preferenceOrder = [
    POLICY_DECISIONS.EXCHANGE,
    POLICY_DECISIONS.STORE_CREDIT,
    POLICY_DECISIONS.PARTIAL_REFUND,
    POLICY_DECISIONS.MANUAL_REVIEW,
  ];

  for (const option of preferenceOrder) {
    if (allowedOptions.includes(option)) {
      return option;
    }
  }

  if (settings.allowManualReviewFallback) {
    return POLICY_DECISIONS.MANUAL_REVIEW;
  }

  return POLICY_DECISIONS.REJECT;
}

function getPrimaryItemForExclusion(returnRequest, itemList) {
  const primaryReason = getPrimaryReason(returnRequest, itemList);

  for (const item of itemList) {
    const reason = item?.reason ?? item?.returnReason;
    if (primaryReason && normalizeUiReason(reason) === primaryReason) {
      return item;
    }
  }

  return itemList[0] ?? null;
}

function suppressAutomatedRecoveryOptions(allowedOptions, blockedOptions) {
  const automatedOptions = [
    POLICY_DECISIONS.EXCHANGE,
    POLICY_DECISIONS.STORE_CREDIT,
    POLICY_DECISIONS.PARTIAL_REFUND,
  ];

  return {
    allowedOptions: allowedOptions.filter(
      (option) => !automatedOptions.includes(option),
    ),
    blockedOptions: [...new Set([...blockedOptions, ...automatedOptions])],
  };
}

function buildExcludedProductResult({
  exclusionResult,
  reason,
  secondaryReasons,
  legalFlags,
  allowedOptions,
  blockedOptions,
  guardrails,
  confidence = "LOW",
}) {
  // Product exclusion pre-flight: suppress automated recovery offers and
  // skip generateOfferLadder(). ACL / consumer-law routing is preserved.
  const suppressed = suppressAutomatedRecoveryOptions(
    allowedOptions,
    blockedOptions,
  );

  return buildResult({
    decision: POLICY_DECISIONS.MANUAL_REVIEW,
    reason,
    secondaryReasons: [...secondaryReasons, POLICY_REASONS.PRODUCT_EXCLUDED],
    legalFlags,
    allowedOptions: suppressed.allowedOptions,
    blockedOptions: suppressed.blockedOptions,
    guardrails: [
      ...guardrails,
      POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED,
      ...(legalFlags.includes(POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY)
        ? [
            POLICY_GUARDRAILS.MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW,
            POLICY_GUARDRAILS.AI_CANNOT_PROMISE_REFUND,
          ]
        : []),
    ],
    confidence,
    productExclusion: exclusionResult,
    recoveryOffers: [],
    generateOfferLadderInvoked: false,
    aiConfidenceBypassed: true,
    aiPersuasionEnabled: false,
  });
}

/**
 * Merchant Settings Gate + Recovery Rules step of the pipeline.
 * Only runs for non-excluded items (product exclusion is a pre-flight check).
 *
 * @param {{
 *   merchantSettings?: Record<string, unknown> | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   context: {
 *     primaryReason: string;
 *     riskLevel: string;
 *     orderTotal: number | null;
 *   };
 * }} input
 */
export function generateOfferLadder({
  merchantSettings,
  recoveryRules,
  context,
}) {
  const settings = normalizeMerchantSettings(merchantSettings);
  const ladderRules = getOfferLadderRules(recoveryRules)
    .filter(isRuleEnabled)
    .sort((left, right) => getRulePriority(left) - getRulePriority(right));

  const offers = [];

  for (const rule of ladderRules) {
    if (!ruleMatchesRequest(rule, context)) {
      continue;
    }

    const mapped = safeMapRuleAction(rule);
    if (!isDecisionAllowed(mapped.decision, settings)) {
      continue;
    }

    offers.push({
      decision: mapped.decision,
      ruleId: rule.id ?? null,
      ruleName: rule.name ?? null,
      ruleType: rule.type ?? mapped.decision,
      unsafe: mapped.unsafe,
    });
  }

  return {
    offers,
    primaryOffer: offers[0] ?? null,
  };
}

export function isLegalReturnReason(returnRequest, items = []) {
  return detectLegalReviewSignals(returnRequest, items).triggered;
}

function buildCustomerMessage({
  decision,
  reason,
  secondaryReasons,
  legalFlags,
}) {
  if (reason === POLICY_REASONS.LEGAL_REVIEW_REQUIRED) {
    return "Thanks for sharing the issue. Your request needs to be reviewed by the merchant team before a final outcome is confirmed.";
  }

  if (secondaryReasons.includes(POLICY_REASONS.PRODUCT_EXCLUDED)) {
    return "This product is excluded from automated return recovery. The merchant team will review your request and confirm the next step.";
  }

  if (legalFlags.includes(POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY)) {
    return "Because this may involve a faulty, damaged, or not-as-described product, the merchant team will review it under the store policy and applicable consumer-law obligations.";
  }

  if (reason === POLICY_REASONS.MISSING_DELIVERED_AT) {
    return "We need a little more delivery information before we can confirm your return eligibility. The merchant team will review your request shortly.";
  }

  if (secondaryReasons.includes(POLICY_REASONS.OUTSIDE_RETURN_WINDOW)) {
    return "This request may need review because it may fall outside the standard return window.";
  }

  if (decision === POLICY_DECISIONS.REJECT) {
    return "Based on the current store policy, this return request cannot be approved automatically. The merchant team can confirm the final outcome.";
  }

  if (decision === POLICY_DECISIONS.EXCHANGE) {
    return "Based on the store policy, an exchange is the recommended next step for this return request.";
  }

  if (decision === POLICY_DECISIONS.STORE_CREDIT) {
    return "Based on the store policy, store credit is the recommended next step for this return request.";
  }

  if (decision === POLICY_DECISIONS.PARTIAL_REFUND) {
    return "This return request may qualify for a partial refund recommendation, but merchant approval is always required before any refund is issued.";
  }

  return "Thanks for your patience. The merchant team will review this return request and confirm the next step.";
}

function buildMerchantNote({
  decision,
  reason,
  secondaryReasons,
  legalFlags,
  matchedRuleName,
  guardrails,
}) {
  const parts = [`Policy decision: ${decision}.`, `Primary reason: ${reason}.`];

  if (matchedRuleName) {
    parts.push(`Matched recovery rule: ${matchedRuleName}.`);
  }

  if (secondaryReasons.length > 0) {
    parts.push(`Context: ${secondaryReasons.join(", ")}.`);
  }

  if (legalFlags.length > 0) {
    parts.push(`Legal flags: ${legalFlags.join(", ")}.`);
  }

  if (guardrails.length > 0) {
    parts.push(`Guardrails: ${guardrails.join(", ")}.`);
  }

  parts.push("No automatic refund has been approved.");

  return parts.join(" ");
}

function buildResult({
  decision,
  reason,
  secondaryReasons = [],
  legalFlags = [],
  matchedRuleId = null,
  matchedRuleName = null,
  allowedOptions,
  blockedOptions,
  guardrails = [],
  confidence,
  productExclusion = null,
  recoveryOffers = null,
  generateOfferLadderInvoked = null,
  aiConfidenceBypassed = null,
  aiPersuasionEnabled = null,
}) {
  const mergedGuardrails = [...new Set([...BASE_GUARDRAILS, ...guardrails])];
  const customerMessage = buildCustomerMessage({
    decision,
    reason,
    secondaryReasons,
    legalFlags,
  });
  const merchantNote = buildMerchantNote({
    decision,
    reason,
    secondaryReasons,
    legalFlags,
    matchedRuleName,
    guardrails: mergedGuardrails,
  });

  return {
    decision,
    reason,
    secondaryReasons: [...new Set(secondaryReasons)],
    legalFlags: [...new Set(legalFlags)],
    matchedRuleId: matchedRuleId ?? null,
    matchedRuleName: matchedRuleName ?? null,
    allowedOptions,
    blockedOptions,
    guardrails: mergedGuardrails,
    confidence,
    customerMessage,
    merchantNote,
    ...(productExclusion ? { productExclusion } : {}),
    ...(recoveryOffers != null ? { recoveryOffers } : {}),
    ...(generateOfferLadderInvoked != null
      ? { generateOfferLadderInvoked }
      : {}),
    ...(aiConfidenceBypassed != null ? { aiConfidenceBypassed } : {}),
    ...(aiPersuasionEnabled != null ? { aiPersuasionEnabled } : {}),
  };
}

function applyBlockedRuleAction({
  proposedDecision,
  settings,
  allowedOptions,
  blockedOptions,
  secondaryReasons,
  guardrails,
}) {
  if (isDecisionAllowed(proposedDecision, settings)) {
    return {
      decision: proposedDecision,
      secondaryReasons,
      guardrails,
      settingsBlocked: false,
    };
  }

  const nextSecondary = [
    ...secondaryReasons,
    POLICY_REASONS.SETTINGS_BLOCK_RULE_ACTION,
  ];
  const nextGuardrails = [
    ...guardrails,
    POLICY_GUARDRAILS.SETTINGS_OVERRIDE_RECOVERY_RULES,
  ];
  const nextBlocked = blockedOptions.includes(proposedDecision)
    ? blockedOptions
    : [...blockedOptions, proposedDecision];

  if (settings.allowManualReviewFallback) {
    return {
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      secondaryReasons: nextSecondary,
      guardrails: nextGuardrails,
      blockedOptions: nextBlocked,
      settingsBlocked: true,
    };
  }

  const fallback = chooseDefaultRecoveryPath(settings, allowedOptions);
  return {
    decision: fallback,
    secondaryReasons: nextSecondary,
    guardrails: nextGuardrails,
    blockedOptions: nextBlocked,
    settingsBlocked: true,
  };
}

/**
 * @param {{
 *   merchantSettings?: Record<string, unknown> | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   returnRequest?: Record<string, unknown> | null;
 *   order?: Record<string, unknown> | null;
 *   items?: Array<Record<string, unknown>> | null;
 * }} input
 */
export function evaluateReturnPolicy({
  merchantSettings,
  recoveryRules,
  returnRequest,
  order,
  items,
}) {
  const settings = normalizeMerchantSettings(merchantSettings);
  const itemList = Array.isArray(items)
    ? items
    : Array.isArray(returnRequest?.items)
      ? returnRequest.items
      : [];

  const { allowedOptions, blockedOptions } =
    computeOptionAvailability(settings);
  const primaryReason = getPrimaryReason(returnRequest, itemList);
  const riskLevel = getAggregateRiskLevel(returnRequest, itemList);
  const deliveredAt = getDeliveredAt(returnRequest, order);
  const orderTotal = getOrderTotal(order, returnRequest);

  const context = {
    primaryReason,
    riskLevel,
    orderTotal,
  };

  const secondaryReasons = [];
  const guardrails = [];
  const legalFlags = [];

  const legalSignals = detectLegalReviewSignals(returnRequest, itemList);
  const exclusionRule = findProductExclusionRule(recoveryRules);
  const ladderRules = getOfferLadderRules(recoveryRules);
  const primaryExclusionItem = getPrimaryItemForExclusion(
    returnRequest,
    itemList,
  );
  const exclusionResult = evaluateProductExclusion(
    exclusionRule,
    primaryExclusionItem,
  );

  // Task 32 pre-flight product exclusion (before offer ladder + legal-only paths
  // that do not involve automated recovery). ACL-safe: legal excluded items use
  // LEGAL_REVIEW_REQUIRED, never REJECT.
  if (exclusionResult.productExcluded) {
    if (legalSignals.triggered) {
      if (isDamagedItemReason(primaryReason)) {
        secondaryReasons.push(POLICY_REASONS.DAMAGED_ITEM_REQUIRES_REVIEW);
      }

      if (!deliveredAt) {
        secondaryReasons.push(POLICY_REASONS.MISSING_DELIVERED_AT);
      } else {
        const outsideWindow = isOutsideReturnWindow({
          deliveredAt,
          returnWindowDays: settings.returnWindowDays,
          windowExpiresAt: returnRequest?.windowExpiresAt,
        });

        if (outsideWindow === true) {
          secondaryReasons.push(POLICY_REASONS.OUTSIDE_RETURN_WINDOW);
        }
      }

      legalFlags.push(POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY);
      if (legalSignals.usedKeywordFallback) {
        secondaryReasons.push(POLICY_REASONS.CONSUMER_LAW_OVERRIDE);
      }

      return buildExcludedProductResult({
        exclusionResult,
        reason: POLICY_REASONS.LEGAL_REVIEW_REQUIRED,
        secondaryReasons,
        legalFlags,
        allowedOptions,
        blockedOptions,
        guardrails,
      });
    }

    return buildExcludedProductResult({
      exclusionResult,
      reason: POLICY_REASONS.PRODUCT_EXCLUDED,
      secondaryReasons,
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails,
    });
  }

  if (legalSignals.insufficientInfo && !primaryReason) {
    return buildResult({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      reason: POLICY_REASONS.NO_SAFE_OPTION,
      secondaryReasons,
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails: [...guardrails, POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED],
      confidence: "LOW",
    });
  }

  if (hasFinalSaleItem(itemList)) {
    secondaryReasons.push(POLICY_REASONS.FINAL_SALE_ITEM);
  }

  if (hasNonReturnableItem(itemList)) {
    secondaryReasons.push(POLICY_REASONS.NON_RETURNABLE_ITEM);
  }

  if (legalSignals.triggered) {
    if (isDamagedItemReason(primaryReason)) {
      secondaryReasons.push(POLICY_REASONS.DAMAGED_ITEM_REQUIRES_REVIEW);
    }

    if (!deliveredAt) {
      secondaryReasons.push(POLICY_REASONS.MISSING_DELIVERED_AT);
    } else {
      const outsideWindow = isOutsideReturnWindow({
        deliveredAt,
        returnWindowDays: settings.returnWindowDays,
        windowExpiresAt: returnRequest?.windowExpiresAt,
      });

      if (outsideWindow === true) {
        secondaryReasons.push(POLICY_REASONS.OUTSIDE_RETURN_WINDOW);
      }
    }

    legalFlags.push(POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY);
    if (legalSignals.usedKeywordFallback) {
      secondaryReasons.push(POLICY_REASONS.CONSUMER_LAW_OVERRIDE);
    }

    return buildResult({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      reason: POLICY_REASONS.LEGAL_REVIEW_REQUIRED,
      secondaryReasons,
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails: [
        ...guardrails,
        POLICY_GUARDRAILS.MERCHANT_RULES_CANNOT_OVERRIDE_CONSUMER_LAW,
        POLICY_GUARDRAILS.AI_CANNOT_PROMISE_REFUND,
        POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED,
      ],
      confidence: "LOW",
    });
  }

  if (!deliveredAt) {
    return buildResult({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      reason: POLICY_REASONS.MISSING_DELIVERED_AT,
      secondaryReasons,
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails: [...guardrails, POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED],
      confidence: "LOW",
    });
  }

  const outsideWindow = isOutsideReturnWindow({
    deliveredAt,
    returnWindowDays: settings.returnWindowDays,
    windowExpiresAt: returnRequest?.windowExpiresAt,
  });

  if (outsideWindow === true) {
    secondaryReasons.push(POLICY_REASONS.OUTSIDE_RETURN_WINDOW);

    if (settings.allowManualReviewFallback) {
      return buildResult({
        decision: POLICY_DECISIONS.MANUAL_REVIEW,
        reason: POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
        secondaryReasons,
        legalFlags,
        allowedOptions,
        blockedOptions,
        guardrails: [...guardrails, POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED],
        confidence: "LOW",
      });
    }

    return buildResult({
      decision: POLICY_DECISIONS.REJECT,
      reason: POLICY_REASONS.OUTSIDE_RETURN_WINDOW,
      secondaryReasons,
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails,
      confidence: "MEDIUM",
    });
  }

  if (riskLevel === "HIGH") {
    secondaryReasons.push(POLICY_REASONS.HIGH_RISK_REQUEST);

    return buildResult({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      reason: POLICY_REASONS.HIGH_RISK_REQUEST,
      secondaryReasons,
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails: [
        ...guardrails,
        POLICY_GUARDRAILS.HIGH_RISK_REQUIRES_REVIEW,
        POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED,
      ],
      confidence: "LOW",
    });
  }

  if (isDamagedItemReason(primaryReason)) {
    secondaryReasons.push(POLICY_REASONS.DAMAGED_ITEM_REQUIRES_REVIEW);

    return buildResult({
      decision: POLICY_DECISIONS.MANUAL_REVIEW,
      reason: POLICY_REASONS.DAMAGED_ITEM_REQUIRES_REVIEW,
      secondaryReasons,
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails: [...guardrails, POLICY_GUARDRAILS.HUMAN_REVIEW_REQUIRED],
      confidence: "LOW",
    });
  }

  const offerLadder = generateOfferLadder({
    merchantSettings: settings,
    recoveryRules: ladderRules,
    context,
  });
  const matchedRule = offerLadder.primaryOffer
    ? (ladderRules.find(
        (rule) => rule.id === offerLadder.primaryOffer.ruleId,
      ) ?? {
        id: offerLadder.primaryOffer.ruleId,
        name: offerLadder.primaryOffer.ruleName,
        type: offerLadder.primaryOffer.ruleType,
      })
    : findMatchingRule(ladderRules, context);

  if (matchedRule || offerLadder.primaryOffer) {
    const mapped = offerLadder.primaryOffer
      ? {
          decision: offerLadder.primaryOffer.decision,
          unsafe: offerLadder.primaryOffer.unsafe === true,
        }
      : safeMapRuleAction(matchedRule);
    const ruleGuardrails = mapped.unsafe
      ? [POLICY_GUARDRAILS.NO_AUTO_REFUND]
      : [];
    const applied = applyBlockedRuleAction({
      proposedDecision: mapped.decision,
      settings,
      allowedOptions,
      blockedOptions,
      secondaryReasons,
      guardrails: [...guardrails, ...ruleGuardrails],
    });

    const reason = applied.settingsBlocked
      ? POLICY_REASONS.SETTINGS_BLOCK_RULE_ACTION
      : POLICY_REASONS.RULE_MATCHED;

    return buildResult({
      decision: applied.decision,
      reason,
      secondaryReasons: applied.secondaryReasons,
      legalFlags,
      matchedRuleId:
        offerLadder.primaryOffer?.ruleId ?? matchedRule?.id ?? null,
      matchedRuleName:
        offerLadder.primaryOffer?.ruleName ?? matchedRule?.name ?? null,
      allowedOptions,
      blockedOptions: applied.blockedOptions ?? blockedOptions,
      guardrails: applied.guardrails,
      confidence: applied.settingsBlocked ? "MEDIUM" : "HIGH",
      recoveryOffers: offerLadder.offers,
      generateOfferLadderInvoked: true,
      aiPersuasionEnabled: offerLadder.offers.length > 0,
    });
  }

  const fallbackDecision = chooseDefaultRecoveryPath(settings, allowedOptions);
  const noRuleReason =
    Array.isArray(ladderRules) && ladderRules.some(isRuleEnabled)
      ? POLICY_REASONS.NO_MATCHING_RULE
      : POLICY_REASONS.DEFAULT_RECOVERY_PATH;

  if (fallbackDecision === POLICY_DECISIONS.REJECT) {
    return buildResult({
      decision: POLICY_DECISIONS.REJECT,
      reason: POLICY_REASONS.NO_SAFE_OPTION,
      secondaryReasons: [...secondaryReasons, noRuleReason],
      legalFlags,
      allowedOptions,
      blockedOptions,
      guardrails,
      confidence: "LOW",
    });
  }

  return buildResult({
    decision: fallbackDecision,
    reason: noRuleReason,
    secondaryReasons,
    legalFlags,
    allowedOptions,
    blockedOptions,
    guardrails,
    confidence: "MEDIUM",
  });
}
