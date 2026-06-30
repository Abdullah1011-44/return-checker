import { listMerchantRecoveryRules } from "@/lib/merchantRecoveryRules";
import { prisma } from "@/lib/prisma";
import { mapReturnReason } from "@/lib/returnApiMappers";
import {
  evaluateReturnPolicy,
  POLICY_DECISIONS,
} from "@/lib/returnPolicyEngine";
import {
  reasonKeyFromUiOrPrisma,
  riskPrismaForReason,
} from "@/lib/returnScoring";

const POLICY_DECISION_TO_BEST_ACTION = {
  [POLICY_DECISIONS.EXCHANGE]: "Exchange Product",
  [POLICY_DECISIONS.STORE_CREDIT]: "Store Credit",
  [POLICY_DECISIONS.PARTIAL_REFUND]: "Partial Refund",
  [POLICY_DECISIONS.MANUAL_REVIEW]: "Manual Review",
  [POLICY_DECISIONS.REJECT]: "Manual Review",
};

/**
 * Load merchant-scoped settings and recovery rules for policy evaluation.
 * @param {string} merchantId
 * @param {import("@prisma/client").PrismaClient} [prismaClient]
 */
export async function loadMerchantPolicyContext(
  merchantId,
  prismaClient = prisma,
) {
  const [merchant, settings, recoveryRules] = await Promise.all([
    prismaClient.merchant.findUnique({ where: { id: merchantId } }),
    prismaClient.merchantSettings.findUnique({ where: { merchantId } }),
    listMerchantRecoveryRules(merchantId, prismaClient),
  ]);

  return {
    merchant,
    settings,
    recoveryRules,
    merchantSettings: buildMerchantSettingsForPolicy(merchant, settings),
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} merchant
 * @param {Record<string, unknown> | null | undefined} settings
 */
export function buildMerchantSettingsForPolicy(merchant, settings) {
  return {
    returnWindowDays:
      settings?.returnWindow ?? merchant?.returnWindowDays ?? undefined,
    returnWindow:
      settings?.returnWindow ?? merchant?.returnWindowDays ?? undefined,
    allowExchanges: settings?.allowExchange ?? merchant?.allowExchange,
    allowExchange: settings?.allowExchange ?? merchant?.allowExchange,
    allowStoreCredit: settings?.allowStoreCredit ?? merchant?.allowStoreCredit,
    allowPartialRefunds:
      settings?.allowPartialRefund ?? merchant?.allowPartialRefund,
    allowPartialRefund:
      settings?.allowPartialRefund ?? merchant?.allowPartialRefund,
    allowManualReviewFallback: true,
  };
}

/**
 * @param {Array<Record<string, unknown>>} orderItems
 */
export function buildPolicyItemsFromOrderItems(orderItems = []) {
  return orderItems.map((orderItem) => ({
    reason: null,
    isReturnable: orderItem.isReturnable,
    orderItem: {
      isReturnable: orderItem.isReturnable,
      finalSale: orderItem.isReturnable === false,
    },
  }));
}

/**
 * @param {Array<Record<string, unknown>>} matchedOrderItems
 * @param {Array<Record<string, unknown>>} returnRequestItems
 */
export function buildPolicyItemsFromSubmission(
  matchedOrderItems,
  returnRequestItems,
) {
  return matchedOrderItems.map((orderItem, index) => {
    const requestItem = returnRequestItems[index] ?? {};
    const reasonKey = reasonKeyFromUiOrPrisma(requestItem.returnReason);

    return {
      reason: mapReturnReason(requestItem.returnReason),
      comment: requestItem.comment?.trim() || null,
      riskLevel: riskPrismaForReason(reasonKey),
      isReturnable: orderItem.isReturnable,
      orderItem: {
        isReturnable: orderItem.isReturnable,
        finalSale: orderItem.isReturnable === false,
      },
    };
  });
}

function aggregateSubmissionRiskLevel(returnRequestItems) {
  let highest = "";

  for (const item of returnRequestItems) {
    const risk = riskPrismaForReason(
      reasonKeyFromUiOrPrisma(item.returnReason),
    );
    if (risk === "HIGH") {
      return "HIGH";
    }
    if (risk === "MEDIUM") {
      highest = "MEDIUM";
    }
    if (risk === "LOW" && !highest) {
      highest = "LOW";
    }
  }

  return highest || "MEDIUM";
}

/**
 * @param {Array<Record<string, unknown>>} returnRequestItems
 */
export function buildReturnRequestInput(returnRequestItems = []) {
  const primaryItem = returnRequestItems[0] ?? {};
  const comments = returnRequestItems
    .map((item) => item.comment?.trim())
    .filter(Boolean);

  return {
    reason: primaryItem.returnReason
      ? mapReturnReason(primaryItem.returnReason)
      : null,
    comment: comments.length > 0 ? comments.join(" | ") : null,
    riskLevel: aggregateSubmissionRiskLevel(returnRequestItems),
    items: returnRequestItems.map((item) => ({
      reason: item.returnReason ? mapReturnReason(item.returnReason) : null,
      comment: item.comment?.trim() || null,
      riskLevel: riskPrismaForReason(
        reasonKeyFromUiOrPrisma(item.returnReason),
      ),
    })),
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} order
 */
export function buildOrderInput(order) {
  if (!order) {
    return {};
  }

  return {
    deliveredAt: order.deliveredAt ?? null,
    totalAmount:
      order.totalAmount != null ? Number(order.totalAmount) : undefined,
    status: order.status ?? null,
  };
}

/**
 * Evaluate policy for check-return (order-level, before reasons are known).
 * @param {{
 *   merchantId?: string | null;
 *   merchant?: Record<string, unknown> | null;
 *   settings?: Record<string, unknown> | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   order?: Record<string, unknown> | null;
 * }} input
 */
export async function evaluateReturnPolicyForCheck({
  merchantId,
  merchant,
  settings,
  recoveryRules,
  order,
}) {
  let policyMerchant = merchant;
  let policySettings = settings;
  let policyRules = recoveryRules;

  if (merchantId && (!policySettings || !policyRules)) {
    const context = await loadMerchantPolicyContext(merchantId);
    policyMerchant = context.merchant;
    policySettings = context.settings;
    policyRules = context.recoveryRules;
  }

  return evaluateReturnPolicy({
    merchantSettings: buildMerchantSettingsForPolicy(
      policyMerchant,
      policySettings,
    ),
    recoveryRules: policyRules ?? [],
    returnRequest: {},
    order: buildOrderInput(order),
    items: buildPolicyItemsFromOrderItems(order?.items ?? []),
  });
}

/**
 * Evaluate policy for submit-return using full request context.
 * @param {{
 *   merchantId: string;
 *   merchant?: Record<string, unknown> | null;
 *   settings?: Record<string, unknown> | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   order: Record<string, unknown>;
 *   matchedOrderItems: Array<Record<string, unknown>>;
 *   returnRequestItems: Array<Record<string, unknown>>;
 *   windowExpiresAt?: Date | null;
 * }} input
 */
export async function evaluateReturnPolicyForSubmission({
  merchantId,
  merchant,
  settings,
  recoveryRules,
  order,
  matchedOrderItems,
  returnRequestItems,
  windowExpiresAt = null,
}) {
  let policyMerchant = merchant;
  let policySettings = settings;
  let policyRules = recoveryRules;

  if (!policySettings || !policyRules) {
    const context = await loadMerchantPolicyContext(merchantId);
    policyMerchant = context.merchant;
    policySettings = context.settings;
    policyRules = context.recoveryRules;
  }

  const returnRequest = {
    ...buildReturnRequestInput(returnRequestItems),
    windowExpiresAt: windowExpiresAt?.toISOString?.() ?? windowExpiresAt,
  };

  return evaluateReturnPolicy({
    merchantSettings: buildMerchantSettingsForPolicy(
      policyMerchant,
      policySettings,
    ),
    recoveryRules: policyRules ?? [],
    returnRequest,
    order: buildOrderInput(order),
    items: buildPolicyItemsFromSubmission(
      matchedOrderItems,
      returnRequestItems,
    ),
  });
}

/**
 * @param {string | null | undefined} decision
 */
export function policyDecisionToBestAction(decision) {
  if (!decision) {
    return POLICY_DECISION_TO_BEST_ACTION[POLICY_DECISIONS.MANUAL_REVIEW];
  }

  return (
    POLICY_DECISION_TO_BEST_ACTION[decision] ??
    POLICY_DECISION_TO_BEST_ACTION[POLICY_DECISIONS.MANUAL_REVIEW]
  );
}

/**
 * @param {string[]} allowedOptions
 */
export function mapPolicyOptionsToUiLabels(allowedOptions = []) {
  return allowedOptions
    .map((option) => policyDecisionToBestAction(option))
    .filter((value, index, array) => array.indexOf(value) === index);
}

/**
 * @param {{
 *   decision: string;
 *   customerMessage?: string;
 *   reasonKey?: string;
 *   selectedOptionLabel?: string;
 * }} input
 */
export function buildPolicySummary({
  decision,
  customerMessage,
  reasonKey = "other",
  selectedOptionLabel,
}) {
  const recommended = policyDecisionToBestAction(decision);
  const reasonLabel = reasonKey.replace(/_/g, " ");

  if (customerMessage) {
    return `${customerMessage} Customer reported ${reasonLabel}. Preferred resolution: ${selectedOptionLabel || "not specified"}.`;
  }

  return `Customer reported ${reasonLabel}. Preferred resolution: ${selectedOptionLabel || "not specified"}. Policy recommendation: ${recommended}.`;
}

/**
 * Customer-safe policy payload (no raw internal enum strings in auxiliary fields).
 * @param {ReturnType<typeof evaluateReturnPolicy>} policyResult
 */
export function serializeCustomerPolicyResult(policyResult) {
  return {
    decision: policyResult.decision,
    customerMessage: policyResult.customerMessage,
    recommendedAction: policyDecisionToBestAction(policyResult.decision),
    allowedOptions: mapPolicyOptionsToUiLabels(policyResult.allowedOptions),
    confidence: policyResult.confidence,
  };
}

/**
 * API-safe policy payload for submit/check responses until persistence exists.
 * @param {ReturnType<typeof evaluateReturnPolicy>} policyResult
 */
export function serializePolicyResultForApi(policyResult) {
  return {
    ...serializeCustomerPolicyResult(policyResult),
    matchedRuleId: policyResult.matchedRuleId ?? null,
    matchedRuleName: policyResult.matchedRuleName ?? null,
  };
}
