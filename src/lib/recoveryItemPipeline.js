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
 *   generateOfferLadderFn?: typeof generateOfferLadder;
 * }} input
 */
export function evaluateItemRecoveryPipeline({
  itemContext,
  returnReason = null,
  comment = null,
  recoveryScore = null,
  merchantSettings,
  recoveryRules = [],
  productExclusionRule = null,
  aiConfidenceThreshold = null,
  policyContext = {},
  generateOfferLadderFn = generateOfferLadder,
}) {
  const exclusionRule =
    productExclusionRule ?? findProductExclusionRule(recoveryRules);
  const exclusionResult = evaluateProductExclusion(exclusionRule, itemContext);

  // Pre-flight product exclusion: skip merchant settings, recovery rules,
  // aiConfidenceThreshold, and generateOfferLadder() for this item.
  if (exclusionResult.productExcluded) {
    return buildExcludedItemPipelineResult(
      exclusionResult,
      returnReason,
      comment,
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
    return {
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
    };
  }

  const primaryOffer = offerLadder.primaryOffer;

  return {
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
  };
}
