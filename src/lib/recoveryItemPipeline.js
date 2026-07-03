/**
 * Per-item recovery pipeline (Task 31 + Task 32).
 *
 * Pipeline order:
 *   Product Exclusion Check
 *   → Merchant Settings Gate        (inside generateOfferLadder)
 *   → Recovery Rules              (inside generateOfferLadder)
 *   → AI Guardrails / aiConfidenceThreshold
 *   → generateOfferLadder()
 *   → Final Decision
 *
 * Product exclusion is a pre-flight suppressor — not a recovery offer.
 * Excluded items return early: no offer ladder, no aiConfidenceThreshold gate,
 * no AI persuasion. See productExclusion.js for ACL-safe routing rules.
 */
import { buildAIGuardrailContext } from "@/lib/aiGuardrails";
import { buildDynamicOfferLadder } from "@/lib/dynamicOfferLadder";
import {
  evaluateProductExclusion,
  findProductExclusionRule,
  getOfferLadderRules,
} from "@/lib/productExclusion";
import {
  generateOfferLadder,
  isLegalReturnReason,
  POLICY_DECISIONS,
  POLICY_REASONS,
} from "@/lib/returnPolicyEngine";
import { analyzeReturnReason } from "@/lib/returnReasonIntelligence";

function buildFlatMerchantRulesFromSettings(merchantSettings) {
  if (!merchantSettings || typeof merchantSettings !== "object") {
    return {};
  }

  const flat = {};
  const exchange =
    merchantSettings.allowExchanges ?? merchantSettings.allowExchange;
  const storeCredit = merchantSettings.allowStoreCredit;
  const partialRefund =
    merchantSettings.allowPartialRefunds ?? merchantSettings.allowPartialRefund;
  const manualReview = merchantSettings.allowManualReviewFallback;

  if (exchange != null) {
    flat.exchangeEnabled = exchange !== false;
  }
  if (storeCredit != null) {
    flat.storeCreditEnabled = storeCredit !== false;
  }
  if (partialRefund != null) {
    flat.partialRefundEnabled = partialRefund !== false;
  }
  if (manualReview != null) {
    flat.manualReviewEnabled = manualReview !== false;
  }

  return flat;
}

function mergeExplicitMerchantRules(settingsRules, explicitRules) {
  const merged = { ...settingsRules };

  if (!explicitRules || typeof explicitRules !== "object") {
    return merged;
  }

  for (const [key, value] of Object.entries(explicitRules)) {
    if (value != null) {
      merged[key] = value;
    }
  }

  return merged;
}

function buildPolicyDecisionForLadder({
  pipelineReason,
  pipelineDecision,
  externalPolicyDecision,
}) {
  if (externalPolicyDecision && typeof externalPolicyDecision === "object") {
    return externalPolicyDecision;
  }

  const policyDecision = {};

  if (pipelineDecision != null) {
    policyDecision.decision = pipelineDecision;
  }
  if (pipelineReason != null) {
    policyDecision.reason = pipelineReason;
  }

  if (pipelineReason === POLICY_REASONS.LEGAL_REVIEW_REQUIRED) {
    policyDecision.status = "LEGAL_REVIEW_REQUIRED";
  }

  return policyDecision;
}

function buildExclusionDecisionForLadder(exclusionResult) {
  if (!exclusionResult?.productExcluded) {
    return { productExcluded: false };
  }

  return {
    productExcluded: true,
    excluded: true,
    status: "EXCLUDED",
    reason: exclusionResult.exclusionReason ?? "PRODUCT_EXCLUDED",
    exclusionRuleId: exclusionResult.exclusionRuleId ?? null,
    matchedField: exclusionResult.matchedField ?? null,
    matchedValue: exclusionResult.matchedValue ?? null,
  };
}

function buildRecoveryDecisionForLadder({ manualReviewRequired = false }) {
  if (!manualReviewRequired) {
    return {};
  }

  return { manualReviewRequired: true };
}

function attachDynamicOfferLadder(
  result,
  {
    item,
    order,
    customerReason,
    policyDecision,
    exclusionDecision,
    recoveryDecision,
    merchantRules,
    recoveryRules,
    context,
    buildDynamicOfferLadderFn = buildDynamicOfferLadder,
  },
) {
  const dynamicOfferLadder = buildDynamicOfferLadderFn({
    item,
    order,
    customerReason,
    policyDecision,
    exclusionDecision,
    recoveryDecision,
    merchantRules,
    recoveryRules,
    context,
  });

  return {
    ...result,
    dynamicOfferLadder,
  };
}

function extractProductTitle(itemContext) {
  return (
    itemContext?.productName ??
    itemContext?.title ??
    itemContext?.orderItem?.productName ??
    null
  );
}

function extractProductType(itemContext) {
  return (
    itemContext?.productType ??
    itemContext?.product?.productType ??
    itemContext?.orderItem?.productType ??
    itemContext?.orderItem?.product?.productType ??
    null
  );
}

function resolvePipelineStoreType(merchantSettings, storeType) {
  return storeType ?? merchantSettings?.storeType ?? null;
}

/**
 * @param {{
 *   itemContext: Record<string, unknown>;
 *   returnReason?: string | null;
 *   customerReason?: string | null;
 *   comment?: string | null;
 *   merchantSettings?: Record<string, unknown> | null;
 *   storeType?: string | null;
 *   recoveryOption?: string | null;
 *   analyzeReturnReasonFn?: typeof analyzeReturnReason;
 * }} input
 */
export function buildReasonIntelligence({
  itemContext,
  returnReason = null,
  customerReason = null,
  comment = null,
  merchantSettings = null,
  storeType = null,
  recoveryOption = null,
  analyzeReturnReasonFn = analyzeReturnReason,
}) {
  const analysis = analyzeReturnReasonFn({
    reason: customerReason ?? returnReason ?? null,
    comment,
    productTitle: extractProductTitle(itemContext),
    productType: extractProductType(itemContext),
    storeType: resolvePipelineStoreType(merchantSettings, storeType),
    recoveryOption,
  });

  return {
    inputReason: analysis.inputReason,
    normalizedReason: analysis.normalizedReason,
    reasonGroup: analysis.reasonGroup,
    severity: analysis.severity,
    customerIntent: analysis.customerIntent,
    recoveryOpportunity: analysis.recoveryOpportunity,
    recommendedNextStep: analysis.recommendedNextStep,
    followUpNeeded: analysis.followUpNeeded,
    followUpType: analysis.followUpType,
    merchantInsightTags: analysis.merchantInsightTags,
    confidence: analysis.confidence,
    storeType: analysis.storeType,
    productType: analysis.productType,
    productContextTags: analysis.productContextTags,
    qualityIssueType: analysis.qualityIssueType,
  };
}

function attachReasonIntelligence(result, reasonIntelligence) {
  return {
    ...result,
    reasonIntelligence,
  };
}

function passesAiConfidenceThreshold(recoveryScore, aiConfidenceThreshold) {
  if (aiConfidenceThreshold == null) {
    return true;
  }

  const threshold = Number(aiConfidenceThreshold);
  if (!Number.isFinite(threshold)) {
    return true;
  }

  const score = Number(recoveryScore);
  if (!Number.isFinite(score)) {
    return false;
  }

  return score / 100 >= threshold;
}

function buildExcludedItemPipelineResult(
  exclusionResult,
  returnReason,
  comment,
) {
  const returnRequest = {
    reason: returnReason,
    comment,
  };
  const items = [{ reason: returnReason, comment }];
  const legalTriggered = isLegalReturnReason(returnRequest, items);

  // Excluded + legal issue → LEGAL_REVIEW_REQUIRED (never auto-reject).
  // Excluded + normal reason → MANUAL_REVIEW via PRODUCT_EXCLUDED.
  return {
    productExcluded: true,
    productExclusion: exclusionResult,
    decision: POLICY_DECISIONS.MANUAL_REVIEW,
    reason: legalTriggered
      ? POLICY_REASONS.LEGAL_REVIEW_REQUIRED
      : POLICY_REASONS.PRODUCT_EXCLUDED,
    legalFlags: legalTriggered
      ? [POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY]
      : [],
    recoveryOffers: [],
    offerLadder: null,
    generateOfferLadderInvoked: false,
    aiConfidenceBypassed: true,
    aiPersuasionEnabled: false,
    aiOfferSuppressed: true,
    guardrailContext: legalTriggered
      ? buildAIGuardrailContext({
          decision: POLICY_DECISIONS.MANUAL_REVIEW,
          legalFlags: [POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY],
          allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
        })
      : buildAIGuardrailContext({
          decision: POLICY_DECISIONS.MANUAL_REVIEW,
          allowedOptions: [POLICY_DECISIONS.MANUAL_REVIEW],
        }),
  };
}

/**
 * Per-item recovery pipeline:
 * Product Exclusion → Merchant Settings Gate → Recovery Rules → AI Guardrails → Offer Ladder
 *
 * @param {{
 *   itemContext: Record<string, unknown>;
 *   returnReason?: string | null;
 *   comment?: string | null;
 *   recoveryScore?: number | null;
 *   merchantSettings?: Record<string, unknown> | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   productExclusionRule?: Record<string, unknown> | null;
 *   aiConfidenceThreshold?: number | null;
 *   policyContext?: {
 *     primaryReason?: string;
 *     riskLevel?: string;
 *     orderTotal?: number | null;
 *   };
 *   customerReason?: string | null;
 *   order?: Record<string, unknown> | null;
 *   merchantRules?: Record<string, unknown> | null;
 *   policyDecision?: Record<string, unknown> | null;
 *   ladderContext?: {
 *     exchangeStockAvailable?: boolean;
 *     matchedExchangeVariantId?: string | null;
 *     matchedExchangeVariantTitle?: string | null;
 *   } | null;
 *   storeType?: string | null;
 *   recoveryOption?: string | null;
 *   generateOfferLadderFn?: typeof generateOfferLadder;
 *   buildDynamicOfferLadderFn?: typeof buildDynamicOfferLadder;
 *   analyzeReturnReasonFn?: typeof analyzeReturnReason;
 * }} input
 */
export function evaluateItemRecoveryPipeline({
  itemContext,
  returnReason = null,
  comment = null,
  recoveryScore = null,
  merchantSettings,
  merchantRules = null,
  recoveryRules = [],
  productExclusionRule = null,
  aiConfidenceThreshold = null,
  policyContext = {},
  customerReason = null,
  order = null,
  policyDecision: externalPolicyDecision = null,
  ladderContext = null,
  storeType = null,
  recoveryOption = null,
  generateOfferLadderFn = generateOfferLadder,
  buildDynamicOfferLadderFn = buildDynamicOfferLadder,
  analyzeReturnReasonFn = analyzeReturnReason,
}) {
  const exclusionRule =
    productExclusionRule ?? findProductExclusionRule(recoveryRules);
  const exclusionResult = evaluateProductExclusion(exclusionRule, itemContext);
  const resolvedCustomerReason =
    customerReason ?? policyContext.primaryReason ?? returnReason ?? "";
  const reasonIntelligence = buildReasonIntelligence({
    itemContext,
    returnReason,
    customerReason: resolvedCustomerReason,
    comment,
    merchantSettings,
    storeType,
    recoveryOption,
    analyzeReturnReasonFn,
  });
  const explicitMerchantRules = mergeExplicitMerchantRules(
    buildFlatMerchantRulesFromSettings(merchantSettings),
    merchantRules,
  );

  function finalizePipelineResult(
    result,
    { manualReviewRequired = false, policyDecision = null } = {},
  ) {
    const exclusionDecision = buildExclusionDecisionForLadder(exclusionResult);
    const resolvedPolicyDecision =
      policyDecision ??
      buildPolicyDecisionForLadder({
        pipelineReason: result.reason,
        pipelineDecision: result.decision,
        externalPolicyDecision,
      });
    const recoveryDecision = buildRecoveryDecisionForLadder({
      manualReviewRequired,
    });

    return attachDynamicOfferLadder(
      attachReasonIntelligence(result, reasonIntelligence),
      {
        item: itemContext,
        order,
        customerReason: resolvedCustomerReason,
        policyDecision: resolvedPolicyDecision,
        exclusionDecision,
        recoveryDecision,
        merchantRules: explicitMerchantRules,
        recoveryRules,
        context: ladderContext ?? {},
        buildDynamicOfferLadderFn,
      },
    );
  }

  // Pre-flight product exclusion: skip merchant settings, recovery rules,
  // aiConfidenceThreshold, and generateOfferLadder() for this item.
  if (exclusionResult.productExcluded) {
    return finalizePipelineResult(
      buildExcludedItemPipelineResult(exclusionResult, returnReason, comment),
    );
  }

  const ladderRules = getOfferLadderRules(recoveryRules);
  const context = {
    primaryReason: policyContext.primaryReason ?? returnReason ?? "",
    riskLevel: policyContext.riskLevel ?? "MEDIUM",
    orderTotal: policyContext.orderTotal ?? null,
  };

  const offerLadder = generateOfferLadderFn({
    merchantSettings,
    recoveryRules: ladderRules,
    context,
  });

  const guardrailContext = buildAIGuardrailContext({
    decision:
      offerLadder.primaryOffer?.decision ?? POLICY_DECISIONS.MANUAL_REVIEW,
    allowedOptions: offerLadder.offers.map((offer) => offer.decision),
    guardrails: [],
  });

  if (!passesAiConfidenceThreshold(recoveryScore, aiConfidenceThreshold)) {
    return finalizePipelineResult(
      {
        productExcluded: false,
        decision: POLICY_DECISIONS.MANUAL_REVIEW,
        reason: POLICY_REASONS.NO_SAFE_OPTION,
        legalFlags: [],
        recoveryOffers: [],
        offerLadder,
        generateOfferLadderInvoked: true,
        aiConfidenceBypassed: false,
        aiPersuasionEnabled: false,
        aiOfferSuppressed: true,
        guardrailContext,
      },
      { manualReviewRequired: true },
    );
  }

  const primaryOffer = offerLadder.primaryOffer;

  return finalizePipelineResult({
    productExcluded: false,
    decision: primaryOffer?.decision ?? POLICY_DECISIONS.MANUAL_REVIEW,
    reason: primaryOffer
      ? POLICY_REASONS.RULE_MATCHED
      : POLICY_REASONS.NO_MATCHING_RULE,
    legalFlags: [],
    recoveryOffers: offerLadder.offers,
    offerLadder,
    generateOfferLadderInvoked: true,
    aiConfidenceBypassed: false,
    aiPersuasionEnabled: offerLadder.offers.length > 0,
    aiOfferSuppressed: offerLadder.offers.length === 0,
    guardrailContext,
  });
}
