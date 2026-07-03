/**
 * Per-item recovery decisions for customer APIs (Task 32 integration).
 *
 * Uses recoveryItemPipeline.js for the ordered pipeline:
 *   Product Exclusion Check → Merchant Settings Gate → Recovery Rules
 *   → AI Guardrails / aiConfidenceThreshold → generateOfferLadder() → Final Decision
 *
 * Response field separation:
 * - customerMessage: safe customer-facing copy (e.g. "This item needs merchant review.")
 * - exclusionReason: merchant-facing explanation of why the product is excluded
 * - exclusionRuleId / matchedField / matchedValue: merchant-facing metadata only
 *
 * recommendedAction summary values:
 * - MANUAL_REVIEW — excluded product, normal non-legal return reason
 * - LEGAL_REVIEW_REQUIRED — excluded product, faulty/damaged/defective/not-as-described
 * - OFFER_* — non-excluded product that passed the offer ladder
 */
import { findProductExclusionRule } from "@/lib/productExclusion";
import { evaluateItemRecoveryPipeline } from "@/lib/recoveryItemPipeline";
import { mapReturnReason } from "@/lib/returnApiMappers";
import {
  evaluateReturnPolicy,
  POLICY_DECISIONS,
  POLICY_REASONS,
} from "@/lib/returnPolicyEngine";
import {
  buildMerchantSettingsForPolicy,
  buildOrderInput,
  buildPolicyItemsFromOrderItems,
  buildPolicyItemsFromSubmission,
  buildReturnRequestInput,
  loadMerchantPolicyContext,
  policyDecisionToBestAction,
  serializePolicyResultForApi,
} from "@/lib/returnPolicyIntegration";
import {
  reasonKeyFromUiOrPrisma,
  riskPrismaForReason,
  scoreForReason,
} from "@/lib/returnScoring";

export const EXCLUDED_ITEM_CUSTOMER_MESSAGE =
  "This item needs merchant review.";

function asRecoveryOffers(offers = []) {
  return offers.map((offer) => ({
    type: offer.decision,
    recommendedAction: decisionToRecommendedAction({
      productExcluded: false,
      decision: offer.decision,
    }),
    ruleId: offer.ruleId ?? null,
    ruleName: offer.ruleName ?? null,
  }));
}

/**
 * @param {{
 *   productExcluded?: boolean;
 *   decision?: string;
 *   reason?: string;
 * }} input
 */
export function decisionToRecommendedAction({
  productExcluded = false,
  decision,
  reason,
}) {
  if (productExcluded) {
    return reason === POLICY_REASONS.LEGAL_REVIEW_REQUIRED
      ? "LEGAL_REVIEW_REQUIRED"
      : "MANUAL_REVIEW";
  }

  switch (decision) {
    case POLICY_DECISIONS.EXCHANGE:
      return "OFFER_EXCHANGE";
    case POLICY_DECISIONS.STORE_CREDIT:
      return "OFFER_STORE_CREDIT";
    case POLICY_DECISIONS.PARTIAL_REFUND:
      return "OFFER_PARTIAL_REFUND";
    case POLICY_DECISIONS.REJECT:
      return "MANUAL_REVIEW";
    default:
      return "MANUAL_REVIEW";
  }
}

function buildPolicyDecisionFromPipeline(pipelineResult) {
  return {
    decision: pipelineResult.decision,
    reason: pipelineResult.reason,
    legalFlags: pipelineResult.legalFlags ?? [],
    recoveryOffers: asRecoveryOffers(pipelineResult.recoveryOffers),
    generateOfferLadderInvoked:
      pipelineResult.generateOfferLadderInvoked === true,
    aiOfferSuppressed: pipelineResult.aiPersuasionEnabled === false,
  };
}

/**
 * @param {{
 *   itemId: string;
 *   pipelineResult: ReturnType<typeof evaluateItemRecoveryPipeline>;
 *   includeMerchantMetadata?: boolean;
 * }} input
 *
 * Serializes per-item decision fields. Customer copy (customerMessage) is kept
 * separate from merchant metadata (exclusionReason, exclusionRuleId, etc.).
 */
export function serializeItemRecoveryDecision({
  itemId,
  pipelineResult,
  includeMerchantMetadata = true,
}) {
  const productExcluded = pipelineResult.productExcluded === true;
  const recommendedAction = decisionToRecommendedAction({
    productExcluded,
    decision: pipelineResult.decision,
    reason: pipelineResult.reason,
  });

  const summary = {
    itemId,
    productExcluded,
    recommendedAction,
    recoveryOffers: productExcluded
      ? []
      : asRecoveryOffers(pipelineResult.recoveryOffers),
    aiOfferSuppressed:
      productExcluded || pipelineResult.aiPersuasionEnabled === false,
    policyDecision: buildPolicyDecisionFromPipeline(pipelineResult),
    ...(pipelineResult.dynamicOfferLadder
      ? { dynamicOfferLadder: pipelineResult.dynamicOfferLadder }
      : {}),
    ...(pipelineResult.reasonIntelligence
      ? { reasonIntelligence: pipelineResult.reasonIntelligence }
      : {}),
  };

  if (productExcluded) {
    summary.customerMessage = EXCLUDED_ITEM_CUSTOMER_MESSAGE;
    if (includeMerchantMetadata && pipelineResult.productExclusion) {
      summary.exclusionReason =
        pipelineResult.productExclusion.exclusionReason ?? null;
      summary.exclusionRuleId =
        pipelineResult.productExclusion.exclusionRuleId ?? null;
      summary.matchedField =
        pipelineResult.productExclusion.matchedField ?? null;
      summary.matchedValue =
        pipelineResult.productExclusion.matchedValue ?? null;
    }
  }

  return summary;
}

/**
 * @param {ReturnType<typeof serializeItemRecoveryDecision>} decision
 */
export function buildItemExclusionMerchantNote(decision) {
  if (!decision?.productExcluded) {
    return null;
  }

  return JSON.stringify({
    productExcluded: true,
    recommendedAction: decision.recommendedAction,
    exclusionReason: decision.exclusionReason ?? null,
    exclusionRuleId: decision.exclusionRuleId ?? null,
    matchedField: decision.matchedField ?? null,
    matchedValue: decision.matchedValue ?? null,
    aiOfferSuppressed: true,
  });
}

/**
 * @param {Record<string, unknown>} checkItem
 * @param {ReturnType<typeof serializeItemRecoveryDecision>} decision
 */
export function mergeCheckItemWithDecision(checkItem, decision) {
  if (!decision) {
    return checkItem;
  }

  return {
    ...checkItem,
    productExcluded: decision.productExcluded,
    recommendedAction: decision.recommendedAction,
    recoveryOffers: decision.recoveryOffers,
    aiOfferSuppressed: decision.aiOfferSuppressed,
    ...(decision.customerMessage
      ? { customerMessage: decision.customerMessage }
      : {}),
    ...(decision.productExcluded
      ? {
          exclusionReason: decision.exclusionReason,
          exclusionRuleId: decision.exclusionRuleId,
          matchedField: decision.matchedField,
          matchedValue: decision.matchedValue,
        }
      : {}),
    ...(decision.policyDecision
      ? { policyDecision: decision.policyDecision }
      : {}),
    ...(decision.dynamicOfferLadder
      ? { dynamicOfferLadder: decision.dynamicOfferLadder }
      : {}),
    ...(decision.reasonIntelligence
      ? { reasonIntelligence: decision.reasonIntelligence }
      : {}),
  };
}

/**
 * @param {ReturnType<typeof serializeItemRecoveryDecision>} decision
 */
export function buildSingleItemTopLevelFields(decision) {
  if (!decision) {
    return {};
  }

  return {
    productExcluded: decision.productExcluded,
    recommendedAction: decision.recommendedAction,
    recoveryOffers: decision.recoveryOffers,
    aiOfferSuppressed: decision.aiOfferSuppressed,
    ...(decision.customerMessage
      ? { customerMessage: decision.customerMessage }
      : {}),
    ...(decision.productExcluded
      ? {
          exclusionReason: decision.exclusionReason,
          exclusionRuleId: decision.exclusionRuleId,
          matchedField: decision.matchedField,
          matchedValue: decision.matchedValue,
        }
      : {}),
    ...(decision.policyDecision
      ? { policyDecision: decision.policyDecision }
      : {}),
    ...(decision.dynamicOfferLadder
      ? { dynamicOfferLadder: decision.dynamicOfferLadder }
      : {}),
    ...(decision.reasonIntelligence
      ? { reasonIntelligence: decision.reasonIntelligence }
      : {}),
  };
}

function buildOrderItemContext(orderItem) {
  return {
    sku: orderItem.sku,
    shopifyProductId: orderItem.shopifyProductId,
    shopifyVariantId: orderItem.shopifyVariantId,
    productName: orderItem.productName,
    title: orderItem.productName,
    productType:
      orderItem.productType ?? orderItem.product?.productType ?? null,
    product: orderItem.product,
    orderItem,
  };
}

function buildLadderContextFromOrderItem(orderItem, ladderContext) {
  const context = { ...(ladderContext ?? {}) };

  if (
    orderItem?.exchangeStockAvailable != null &&
    context.exchangeStockAvailable == null
  ) {
    context.exchangeStockAvailable = orderItem.exchangeStockAvailable;
  }
  if (
    orderItem?.matchedExchangeVariantId != null &&
    context.matchedExchangeVariantId == null
  ) {
    context.matchedExchangeVariantId = orderItem.matchedExchangeVariantId;
  }
  if (
    orderItem?.matchedExchangeVariantTitle != null &&
    context.matchedExchangeVariantTitle == null
  ) {
    context.matchedExchangeVariantTitle = orderItem.matchedExchangeVariantTitle;
  }

  return Object.keys(context).length > 0 ? context : null;
}

/**
 * @param {{
 *   orderItem: Record<string, unknown>;
 *   returnReason?: string | null;
 *   comment?: string | null;
 *   merchantSettings: Record<string, unknown>;
 *   recoveryRules: Array<Record<string, unknown>>;
 *   productExclusionRule?: Record<string, unknown> | null;
 *   aiConfidenceThreshold?: number | null;
 *   order?: Record<string, unknown> | null;
 *   merchantRules?: Record<string, unknown> | null;
 *   policyDecision?: Record<string, unknown> | null;
 *   ladderContext?: Record<string, unknown> | null;
 *   recoveryOption?: string | null;
 *   generateOfferLadderFn?: Parameters<typeof evaluateItemRecoveryPipeline>[0]["generateOfferLadderFn"];
 *   buildDynamicOfferLadderFn?: Parameters<typeof evaluateItemRecoveryPipeline>[0]["buildDynamicOfferLadderFn"];
 * }} input
 */
export function evaluateOrderItemRecoveryDecision({
  orderItem,
  returnReason = null,
  comment = null,
  merchantSettings,
  recoveryRules,
  productExclusionRule = null,
  aiConfidenceThreshold = null,
  order = null,
  merchantRules = null,
  policyDecision = null,
  ladderContext = null,
  recoveryOption = null,
  generateOfferLadderFn,
  buildDynamicOfferLadderFn,
}) {
  const reasonKey = returnReason
    ? reasonKeyFromUiOrPrisma(returnReason)
    : "other";
  const mappedReason = returnReason ? mapReturnReason(returnReason) : null;

  const pipelineResult = evaluateItemRecoveryPipeline({
    itemContext: buildOrderItemContext(orderItem),
    returnReason: mappedReason ?? returnReason,
    customerReason: returnReason,
    comment,
    recoveryScore: returnReason ? scoreForReason(reasonKey) : null,
    merchantSettings,
    merchantRules,
    recoveryRules,
    productExclusionRule,
    aiConfidenceThreshold,
    order,
    policyDecision,
    ladderContext: buildLadderContextFromOrderItem(orderItem, ladderContext),
    policyContext: {
      primaryReason: mappedReason ?? "",
      riskLevel: returnReason ? riskPrismaForReason(reasonKey) : "MEDIUM",
      orderTotal: order?.totalAmount != null ? Number(order.totalAmount) : null,
    },
    storeType: merchantSettings?.storeType ?? null,
    recoveryOption,
    generateOfferLadderFn,
    buildDynamicOfferLadderFn,
  });

  return serializeItemRecoveryDecision({
    itemId: orderItem.id,
    pipelineResult,
  });
}

function buildAggregatePolicyResult({
  itemDecisions,
  merchantSettings,
  recoveryRules,
  returnRequest,
  order,
  matchedOrderItems,
  returnRequestItems,
}) {
  const nonExcludedItems = itemDecisions.filter(
    (decision) => !decision.productExcluded,
  );

  if (nonExcludedItems.length === 0) {
    return evaluateReturnPolicy({
      merchantSettings,
      recoveryRules,
      returnRequest: returnRequest ?? {},
      order: buildOrderInput(order),
      items:
        matchedOrderItems && returnRequestItems
          ? buildPolicyItemsFromSubmission(
              matchedOrderItems,
              returnRequestItems,
            )
          : buildPolicyItemsFromOrderItems(matchedOrderItems ?? []),
    });
  }

  const nonExcludedOrderItems = (matchedOrderItems ?? []).filter(
    (orderItem) => {
      const decision = itemDecisions.find(
        (entry) => entry.itemId === orderItem.id,
      );
      return decision && !decision.productExcluded;
    },
  );
  const nonExcludedRequestItems = (returnRequestItems ?? []).filter((item) => {
    const orderItem = matchedOrderItems?.find(
      (candidate) => candidate.id === item.itemId || candidate.sku === item.sku,
    );
    if (!orderItem) {
      return true;
    }
    const decision = itemDecisions.find(
      (entry) => entry.itemId === orderItem.id,
    );
    return decision && !decision.productExcluded;
  });

  return evaluateReturnPolicy({
    merchantSettings,
    recoveryRules,
    returnRequest:
      returnRequest ??
      buildReturnRequestInput(
        nonExcludedRequestItems.length > 0
          ? nonExcludedRequestItems
          : (returnRequestItems ?? []),
      ),
    order: buildOrderInput(order),
    items:
      nonExcludedRequestItems.length > 0
        ? buildPolicyItemsFromSubmission(
            nonExcludedOrderItems,
            nonExcludedRequestItems,
          )
        : buildPolicyItemsFromOrderItems(nonExcludedOrderItems),
  });
}

/**
 * @param {{
 *   order: Record<string, unknown>;
 *   merchantId: string;
 *   merchant?: Record<string, unknown> | null;
 *   settings?: Record<string, unknown> | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   generateOfferLadderFn?: Parameters<typeof evaluateItemRecoveryPipeline>[0]["generateOfferLadderFn"];
 * }} input
 */
export async function evaluateCheckReturnItemDecisions({
  order,
  merchantId,
  merchant,
  settings,
  recoveryRules,
  generateOfferLadderFn,
}) {
  let policyMerchant = merchant;
  let policySettings = settings;
  let policyRules = recoveryRules;
  let aiConfidenceThreshold = null;

  if (!policySettings || !policyRules) {
    const context = await loadMerchantPolicyContext(merchantId);
    policyMerchant = context.merchant;
    policySettings = context.settings;
    policyRules = context.recoveryRules;
    aiConfidenceThreshold = context.settings?.aiConfidence ?? null;
  }

  const merchantSettings = buildMerchantSettingsForPolicy(
    policyMerchant,
    policySettings,
  );
  const productExclusionRule = findProductExclusionRule(policyRules);
  const orderItems = order?.items ?? [];

  const itemDecisions = orderItems.map((orderItem) =>
    evaluateOrderItemRecoveryDecision({
      orderItem,
      merchantSettings,
      recoveryRules: policyRules ?? [],
      productExclusionRule,
      aiConfidenceThreshold,
      order,
      generateOfferLadderFn,
    }),
  );

  const policyResult = buildAggregatePolicyResult({
    itemDecisions,
    merchantSettings,
    recoveryRules: policyRules ?? [],
    order,
    matchedOrderItems: orderItems,
  });

  return {
    itemDecisions,
    hasExcludedItems: itemDecisions.some(
      (decision) => decision.productExcluded,
    ),
    policyResult,
    serializePolicyResult: () => serializePolicyResultForApi(policyResult),
  };
}

/**
 * @param {{
 *   merchantId: string;
 *   order: Record<string, unknown>;
 *   matchedOrderItems: Array<Record<string, unknown>>;
 *   returnRequestItems: Array<Record<string, unknown>>;
 *   merchant?: Record<string, unknown> | null;
 *   settings?: Record<string, unknown> | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   windowExpiresAt?: Date | null;
 *   generateOfferLadderFn?: Parameters<typeof evaluateItemRecoveryPipeline>[0]["generateOfferLadderFn"];
 * }} input
 */
export async function evaluateSubmitReturnItemDecisions({
  merchantId,
  order,
  matchedOrderItems,
  returnRequestItems,
  merchant,
  settings,
  recoveryRules,
  windowExpiresAt = null,
  generateOfferLadderFn,
}) {
  let policyMerchant = merchant;
  let policySettings = settings;
  let policyRules = recoveryRules;
  let aiConfidenceThreshold = null;

  if (!policySettings || !policyRules) {
    const context = await loadMerchantPolicyContext(merchantId);
    policyMerchant = context.merchant;
    policySettings = context.settings;
    policyRules = context.recoveryRules;
    aiConfidenceThreshold = context.settings?.aiConfidence ?? null;
  }

  const merchantSettings = buildMerchantSettingsForPolicy(
    policyMerchant,
    policySettings,
  );
  const productExclusionRule = findProductExclusionRule(policyRules);

  const itemDecisions = matchedOrderItems.map((orderItem, index) => {
    const requestItem = returnRequestItems[index] ?? {};
    return evaluateOrderItemRecoveryDecision({
      orderItem,
      returnReason: requestItem.returnReason,
      comment: requestItem.comment,
      recoveryOption: requestItem.selectedOption ?? null,
      merchantSettings,
      recoveryRules: policyRules ?? [],
      productExclusionRule,
      aiConfidenceThreshold,
      order,
      generateOfferLadderFn,
    });
  });

  const returnRequest = {
    ...buildReturnRequestInput(returnRequestItems),
    windowExpiresAt: windowExpiresAt?.toISOString?.() ?? windowExpiresAt,
  };

  const policyResult = buildAggregatePolicyResult({
    itemDecisions,
    merchantSettings,
    recoveryRules: policyRules ?? [],
    returnRequest,
    order,
    matchedOrderItems,
    returnRequestItems,
  });

  return {
    itemDecisions,
    hasExcludedItems: itemDecisions.some(
      (decision) => decision.productExcluded,
    ),
    policyResult,
    serializePolicyResult: () => serializePolicyResultForApi(policyResult),
  };
}

/**
 * @param {ReturnType<typeof serializeItemRecoveryDecision>} decision
 * @param {{ reasonKey: string; selectedOptionLabel?: string }} input
 */
export function buildExcludedItemAiSummary(
  decision,
  { reasonKey, selectedOptionLabel },
) {
  const reasonLabel = reasonKey.replace(/_/g, " ");
  return `Customer reported ${reasonLabel}. Preferred resolution: ${selectedOptionLabel || "not specified"}. ${decision.customerMessage}`;
}

/**
 * @param {ReturnType<typeof serializeItemRecoveryDecision>} decision
 */
export function itemDecisionToBestActionLabel(decision) {
  if (decision.productExcluded) {
    return "Manual Review";
  }

  return policyDecisionToBestAction(decision.policyDecision?.decision);
}
