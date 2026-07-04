/**
 * Submit-return offer acceptance integration (Task 36 Prompt 2).
 * Derives trusted server-side acceptance fields from pipeline decisions.
 */
import { normalizeMerchantOfferRules } from "@/lib/dynamicOfferLadder";
import {
  calculateRecoveryAmountCents,
  normalizeOfferType,
  recordOfferAcceptance,
  sanitizeOfferAcceptanceMetadata,
} from "@/lib/offerAcceptanceTracking";
import { mapRecoveryOption } from "@/lib/returnApiMappers";

function recommendedActionToOfferType(recommendedAction) {
  switch (recommendedAction) {
    case "OFFER_EXCHANGE":
      return "EXCHANGE";
    case "OFFER_STORE_CREDIT":
      return "STORE_CREDIT";
    case "OFFER_PARTIAL_REFUND":
      return "PARTIAL_REFUND";
    case "LEGAL_REVIEW_REQUIRED":
      return "LEGAL_REVIEW_REQUIRED";
    default:
      return "MANUAL_REVIEW";
  }
}

function resolveCustomerIntentType(customerSelectedOptionLabel) {
  const mapped = mapRecoveryOption(customerSelectedOptionLabel);
  return normalizeOfferType(mapped ?? customerSelectedOptionLabel);
}

/**
 * @param {Record<string, unknown> | null | undefined} itemDecision
 */
export function deriveLegalReviewRequiredFromDecision(itemDecision) {
  return itemDecision?.recommendedAction === "LEGAL_REVIEW_REQUIRED";
}

/**
 * @param {string | null | undefined} customerSelectedOptionLabel
 * @param {Record<string, unknown> | null | undefined} itemDecision
 */
export function deriveServerApprovedOfferType(
  customerSelectedOptionLabel,
  itemDecision,
) {
  if (deriveLegalReviewRequiredFromDecision(itemDecision)) {
    return "LEGAL_REVIEW_REQUIRED";
  }

  if (itemDecision?.productExcluded === true) {
    return "MANUAL_REVIEW";
  }

  const customerIntent = resolveCustomerIntentType(customerSelectedOptionLabel);
  const serverRecommended = recommendedActionToOfferType(
    itemDecision?.recommendedAction,
  );

  if (itemDecision?.dynamicOfferLadder?.manualReviewRequired === true) {
    if (
      itemDecision?.dynamicOfferLadder?.blockedReason ===
        "legal_review_required" ||
      serverRecommended === "LEGAL_REVIEW_REQUIRED"
    ) {
      return "LEGAL_REVIEW_REQUIRED";
    }

    if (customerIntent !== serverRecommended) {
      return serverRecommended;
    }

    if (customerIntent !== "MANUAL_REVIEW") {
      return "MANUAL_REVIEW";
    }
  }

  if (
    itemDecision?.aiOfferSuppressed === true &&
    itemDecision?.recommendedAction === "MANUAL_REVIEW"
  ) {
    return "MANUAL_REVIEW";
  }

  return customerIntent;
}

/**
 * @param {{
 *   customerSelectedOptionLabel?: string | null;
 *   serverApprovedType: string;
 *   itemDecision?: Record<string, unknown> | null;
 *   followUpInfluenced?: boolean;
 *   returnRequestItem?: Record<string, unknown> | null;
 * }} input
 */
export function deriveSubmitReturnOfferSource({
  customerSelectedOptionLabel = null,
  serverApprovedType,
  itemDecision = null,
  followUpInfluenced = false,
  returnRequestItem = null,
}) {
  if (
    followUpInfluenced ||
    deriveFollowUpInfluenced(itemDecision, returnRequestItem)
  ) {
    return "FOLLOW_UP_ENGINE";
  }

  const customerIntent = resolveCustomerIntentType(customerSelectedOptionLabel);
  const serverConstrained =
    serverApprovedType !== customerIntent ||
    itemDecision?.productExcluded === true ||
    itemDecision?.recommendedAction === "LEGAL_REVIEW_REQUIRED" ||
    (itemDecision?.dynamicOfferLadder?.manualReviewRequired === true &&
      serverApprovedType !== customerIntent);

  if (serverConstrained) {
    return "RULE_ENGINE";
  }

  return "CUSTOMER_SELECTED";
}

function resolveItemPricePaidCents(orderItem) {
  if (!orderItem || typeof orderItem !== "object") {
    return 0;
  }

  if (orderItem.linePriceCents != null) {
    const linePriceCents = Number(orderItem.linePriceCents);
    if (Number.isFinite(linePriceCents)) {
      return Math.max(0, Math.round(linePriceCents));
    }
  }

  const unitPrice = Number(orderItem.price);
  if (!Number.isFinite(unitPrice)) {
    return 0;
  }

  const quantity = Number(orderItem.quantity);
  const multiplier =
    Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;

  return Math.max(0, Math.round(unitPrice * 100 * multiplier));
}

function buildPricingItem(orderItem) {
  if (!orderItem || typeof orderItem !== "object") {
    return orderItem;
  }

  return {
    ...orderItem,
    linePriceCents: resolveItemPricePaidCents(orderItem),
  };
}

/**
 * @param {{
 *   orderItem?: Record<string, unknown> | null;
 *   acceptedOfferType: string;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 * }} input
 */
export function deriveTrustedRecoveryAdjustments({
  orderItem = null,
  acceptedOfferType,
  recoveryRules = [],
}) {
  const itemPriceCents = resolveItemPricePaidCents(orderItem);
  const merchantRules = normalizeMerchantOfferRules(recoveryRules);

  if (acceptedOfferType === "STORE_CREDIT") {
    const bonusPercent = Number(merchantRules.storeCreditBonusPercent);
    if (
      Number.isFinite(bonusPercent) &&
      bonusPercent > 0 &&
      itemPriceCents > 0
    ) {
      return {
        storeCreditBonusCents: Math.round(
          (itemPriceCents * bonusPercent) / 100,
        ),
      };
    }
    return {};
  }

  if (acceptedOfferType === "PARTIAL_REFUND") {
    const maxRefundPercent = Number(merchantRules.maxPartialRefundPercent);
    if (
      Number.isFinite(maxRefundPercent) &&
      maxRefundPercent > 0 &&
      itemPriceCents > 0
    ) {
      return {
        partialRefundAmountCents: Math.round(
          (itemPriceCents * maxRefundPercent) / 100,
        ),
      };
    }

    return { trustedRecoveryAmountUnavailable: true };
  }

  if (
    ["EXCHANGE", "STORE_CREDIT", "PARTIAL_REFUND"].includes(
      acceptedOfferType,
    ) &&
    itemPriceCents <= 0
  ) {
    return { trustedRecoveryAmountUnavailable: true };
  }

  return {};
}

function deriveFollowUpInfluenced(itemDecision, returnRequestItem) {
  if (itemDecision?.followUpQuestion?.shouldAskFollowUp !== true) {
    return false;
  }

  const comment = String(returnRequestItem?.comment ?? "").trim();
  return comment.length >= 12;
}

function findLadderPosition(itemDecision, acceptedOfferType) {
  const offers = itemDecision?.dynamicOfferLadder?.offers;
  if (!Array.isArray(offers)) {
    return null;
  }

  const typeMap = {
    EXCHANGE: "exchange",
    STORE_CREDIT: "store_credit",
    PARTIAL_REFUND: "partial_refund",
    MANUAL_REVIEW: "manual_review",
    LEGAL_REVIEW_REQUIRED: "manual_review",
  };
  const targetType = typeMap[acceptedOfferType];
  if (!targetType) {
    return null;
  }

  const index = offers.findIndex((offer) => offer?.type === targetType);
  return index >= 0 ? index + 1 : null;
}

/**
 * @param {{
 *   merchantId: string;
 *   returnRequestId: string;
 *   returnItem: Record<string, unknown>;
 *   orderItem?: Record<string, unknown> | null;
 *   itemDecision?: Record<string, unknown> | null;
 *   customerSelectedOptionLabel?: string | null;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   order?: Record<string, unknown> | null;
 *   returnRequestItem?: Record<string, unknown> | null;
 * }} input
 */
export function buildSubmitReturnOfferAcceptanceInput({
  merchantId,
  returnRequestId,
  returnItem,
  orderItem = null,
  itemDecision = null,
  customerSelectedOptionLabel = null,
  recoveryRules = [],
  order = null,
  returnRequestItem = null,
}) {
  const legalReviewRequired =
    deriveLegalReviewRequiredFromDecision(itemDecision);
  const acceptedOfferType = deriveServerApprovedOfferType(
    customerSelectedOptionLabel,
    itemDecision,
  );
  const customerIntentType = resolveCustomerIntentType(
    customerSelectedOptionLabel,
  );
  const offerSource = deriveSubmitReturnOfferSource({
    customerSelectedOptionLabel,
    serverApprovedType: acceptedOfferType,
    itemDecision,
    returnRequestItem,
  });
  const trustedAdjustments = deriveTrustedRecoveryAdjustments({
    orderItem,
    acceptedOfferType,
    recoveryRules,
  });

  const itemForPricing = buildPricingItem(
    orderItem ?? returnItem?.orderItem ?? null,
  );
  const calculation = calculateRecoveryAmountCents({
    item: itemForPricing,
    acceptedOfferType,
    originalRequestedOption: customerSelectedOptionLabel,
    partialRefundAmountCents:
      trustedAdjustments.partialRefundAmountCents ?? null,
    storeCreditBonusCents: trustedAdjustments.storeCreditBonusCents ?? null,
  });

  let recoveryAmountCents = legalReviewRequired
    ? 0
    : calculation.recoveryAmountCents;

  const metadata = sanitizeOfferAcceptanceMetadata({
    reason: returnRequestItem?.returnReason ?? returnItem?.reason ?? null,
    riskLevel: returnItem?.riskLevel ?? null,
    recoveryDecision: itemDecision?.recommendedAction ?? null,
    ladderPosition: findLadderPosition(itemDecision, acceptedOfferType),
    ruleVersion: itemDecision?.dynamicOfferLadder?.engineVersion ?? null,
    legalReviewRequired,
    ...(trustedAdjustments.trustedRecoveryAmountUnavailable
      ? { trustedRecoveryAmountUnavailable: true }
      : {}),
    ...(calculation.metadata ?? {}),
  });

  if (
    !legalReviewRequired &&
    trustedAdjustments.trustedRecoveryAmountUnavailable === true &&
    ["STORE_CREDIT", "PARTIAL_REFUND", "EXCHANGE"].includes(acceptedOfferType)
  ) {
    recoveryAmountCents = 0;
  }

  return {
    merchantId,
    returnRequestId,
    returnItemId: returnItem.id,
    originalRequestedOption: customerSelectedOptionLabel,
    acceptedOfferType,
    offerSource,
    currency:
      order?.currency ??
      order?.merchant?.currency ??
      orderItem?.currency ??
      "AUD",
    recoveryAmountCents,
    legalReviewRequired,
    metadata,
    item: itemForPricing,
    partialRefundAmountCents:
      trustedAdjustments.partialRefundAmountCents ?? null,
    storeCreditBonusCents: trustedAdjustments.storeCreditBonusCents ?? null,
    customerIntentType,
  };
}

function logOfferAcceptanceWarning(returnItemId, error) {
  console.warn("[OfferAcceptance] submit-return tracking failed", {
    returnItemId,
    errorName: error?.name ?? "Error",
    message: error?.message ?? "unknown_error",
  });
}

/**
 * @param {{
 *   merchantId: string;
 *   returnRequest: Record<string, unknown>;
 *   returnRequestItems: Array<Record<string, unknown>>;
 *   matchedOrderItems: Array<Record<string, unknown>>;
 *   itemDecisions: Array<Record<string, unknown>>;
 *   recoveryRules?: Array<Record<string, unknown>> | null;
 *   order?: Record<string, unknown> | null;
 *   recordOfferAcceptanceFn?: typeof recordOfferAcceptance;
 * }} input
 */
export async function recordSubmitReturnOfferAcceptancesSafely({
  merchantId,
  returnRequest,
  returnRequestItems,
  matchedOrderItems,
  itemDecisions,
  recoveryRules = [],
  order = null,
  recordOfferAcceptanceFn = recordOfferAcceptance,
}) {
  const returnItems = Array.isArray(returnRequest?.items)
    ? returnRequest.items
    : [];

  for (let index = 0; index < returnItems.length; index += 1) {
    const returnItem = returnItems[index];
    const orderItem = returnItem?.orderItem ?? matchedOrderItems[index] ?? null;
    const itemDecision = itemDecisions[index] ?? null;
    const returnRequestItem = returnRequestItems[index] ?? null;

    try {
      const acceptanceInput = buildSubmitReturnOfferAcceptanceInput({
        merchantId,
        returnRequestId: returnRequest.id,
        returnItem,
        orderItem,
        itemDecision,
        customerSelectedOptionLabel: returnRequestItem?.selectedOption ?? null,
        recoveryRules,
        order,
        returnRequestItem,
      });

      await recordOfferAcceptanceFn(acceptanceInput);
    } catch (error) {
      logOfferAcceptanceWarning(returnItem?.id ?? `index:${index}`, error);
    }
  }
}
