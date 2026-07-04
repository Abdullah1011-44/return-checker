/**
 * Merchant dashboard/analytics mapping for ReturnOfferAcceptance (Task 36 Prompt 3).
 * Current-state tracking only — one row per returnItemId, not append-only history.
 */

export const ACCEPTED_OFFER_TYPE_LABELS = {
  EXCHANGE: "Exchange",
  STORE_CREDIT: "Store Credit",
  PARTIAL_REFUND: "Partial Refund",
  MANUAL_REVIEW: "Manual Review",
  LEGAL_REVIEW_REQUIRED: "Legal Review Required",
};

export const OFFER_SOURCE_LABELS = {
  CUSTOMER_SELECTED: "Customer selected",
  RULE_ENGINE: "Rule engine",
  FOLLOW_UP_ENGINE: "Follow-up engine",
  MERCHANT_MANUAL: "Merchant manual",
  SYSTEM_DEFAULT: "System default",
};

const RECOVERY_ELIGIBLE_TYPES = new Set([
  "EXCHANGE",
  "STORE_CREDIT",
  "PARTIAL_REFUND",
]);

const AI_SOURCE_ALIASES = new Set([
  "AI",
  "AI_ENGINE",
  "AI_DECISION",
  "ANTHROPIC",
  "CLAUDE",
  "LLM",
  "OPENAI",
  "GPT",
  "CHATGPT",
]);

const OFFER_TYPE_ALIASES = {
  EXCHANGE: "EXCHANGE",
  STORE_CREDIT: "STORE_CREDIT",
  PARTIAL_REFUND: "PARTIAL_REFUND",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  LEGAL_REVIEW_REQUIRED: "LEGAL_REVIEW_REQUIRED",
  LEGAL_REVIEW: "LEGAL_REVIEW_REQUIRED",
  OFFER_EXCHANGE: "EXCHANGE",
  OFFER_STORE_CREDIT: "STORE_CREDIT",
  OFFER_PARTIAL_REFUND: "PARTIAL_REFUND",
};

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeAcceptedOfferTypeForAnalytics(value) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized) {
    return "MANUAL_REVIEW";
  }

  if (OFFER_TYPE_ALIASES[normalized]) {
    return OFFER_TYPE_ALIASES[normalized];
  }

  if (ACCEPTED_OFFER_TYPE_LABELS[normalized]) {
    return normalized;
  }

  return "MANUAL_REVIEW";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeOfferSourceForAnalytics(value) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized || AI_SOURCE_ALIASES.has(normalized)) {
    return "SYSTEM_DEFAULT";
  }

  if (OFFER_SOURCE_LABELS[normalized]) {
    return normalized;
  }

  return "SYSTEM_DEFAULT";
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeRecoveryAmountCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.max(0, Math.round(amount));
}

/**
 * @param {number} cents
 * @param {string} [currency]
 */
export function formatRecoveredAmountDisplay(cents, currency = "AUD") {
  const normalizedCents = normalizeRecoveryAmountCents(cents);
  const amount = normalizedCents / 100;

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "AUD",
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function createEmptyAcceptanceByOfferType() {
  return {
    EXCHANGE: 0,
    STORE_CREDIT: 0,
    PARTIAL_REFUND: 0,
    MANUAL_REVIEW: 0,
    LEGAL_REVIEW_REQUIRED: 0,
  };
}

function createEmptyAcceptanceBySource() {
  return {
    CUSTOMER_SELECTED: 0,
    RULE_ENGINE: 0,
    FOLLOW_UP_ENGINE: 0,
    MERCHANT_MANUAL: 0,
    SYSTEM_DEFAULT: 0,
  };
}

/**
 * @param {{ currency?: string }} [options]
 */
export function createEmptyOfferAcceptanceSummary(options = {}) {
  const currency = options.currency ?? "AUD";

  return {
    totalAcceptedOffers: 0,
    acceptedExchangeCount: 0,
    acceptedStoreCreditCount: 0,
    acceptedPartialRefundCount: 0,
    manualReviewCount: 0,
    legalReviewRequiredCount: 0,
    estimatedRecoveredAmountCents: 0,
    estimatedRecoveredAmountDisplay: formatRecoveredAmountDisplay(0, currency),
    acceptanceByOfferType: createEmptyAcceptanceByOfferType(),
    acceptanceBySource: createEmptyAcceptanceBySource(),
  };
}

/**
 * Dedupe to one record per returnItemId (current-state overwrite safety).
 * @param {Array<Record<string, unknown>> | null | undefined} acceptances
 */
export function dedupeOfferAcceptancesByReturnItemId(acceptances) {
  if (!Array.isArray(acceptances)) {
    return [];
  }

  const byReturnItemId = new Map();

  for (const record of acceptances) {
    const returnItemId = record?.returnItemId;
    if (!returnItemId) {
      continue;
    }

    byReturnItemId.set(String(returnItemId), record);
  }

  return Array.from(byReturnItemId.values());
}

/**
 * @param {Record<string, unknown> | null | undefined} acceptance
 */
export function mapOfferAcceptanceToDashboardItem(acceptance) {
  if (!acceptance || typeof acceptance !== "object") {
    return null;
  }

  const acceptedOfferType = normalizeAcceptedOfferTypeForAnalytics(
    acceptance.acceptedOfferType,
  );
  const offerSource = normalizeOfferSourceForAnalytics(acceptance.offerSource);
  const legalReviewRequired = acceptance.legalReviewRequired === true;
  const persistedRecoveryCents = normalizeRecoveryAmountCents(
    acceptance.recoveryAmountCents,
  );
  const currency =
    typeof acceptance.currency === "string" && acceptance.currency.trim()
      ? acceptance.currency.trim().toUpperCase()
      : "AUD";
  const estimatedRecoveredAmountCents =
    legalReviewRequired || !RECOVERY_ELIGIBLE_TYPES.has(acceptedOfferType)
      ? 0
      : persistedRecoveryCents;

  return {
    acceptedOfferType,
    acceptedOfferLabel:
      ACCEPTED_OFFER_TYPE_LABELS[acceptedOfferType] ?? "Manual Review",
    offerSource,
    offerSourceLabel:
      OFFER_SOURCE_LABELS[offerSource] ?? OFFER_SOURCE_LABELS.SYSTEM_DEFAULT,
    legalReviewRequired,
    estimatedRecoveredAmountCents,
    estimatedRecoveredAmountDisplay: formatRecoveredAmountDisplay(
      estimatedRecoveredAmountCents,
      currency,
    ),
    currency,
    originalRequestedOption:
      acceptance.originalRequestedOption != null
        ? String(acceptance.originalRequestedOption)
        : null,
    acceptedAt:
      acceptance.acceptedAt?.toISOString?.() ?? acceptance.acceptedAt ?? null,
  };
}

/**
 * Aggregate metrics from persisted ReturnOfferAcceptance rows only.
 * Recovery totals use recoveryAmountCents as stored — never client/request values.
 *
 * @param {Array<Record<string, unknown>> | null | undefined} acceptances
 * @param {{ currency?: string }} [options]
 */
export function aggregateOfferAcceptanceMetrics(acceptances, options = {}) {
  const currency = options.currency ?? "AUD";
  const summary = createEmptyOfferAcceptanceSummary({ currency });
  const uniqueRecords = dedupeOfferAcceptancesByReturnItemId(acceptances);

  summary.totalAcceptedOffers = uniqueRecords.length;

  for (const record of uniqueRecords) {
    const acceptedOfferType = normalizeAcceptedOfferTypeForAnalytics(
      record.acceptedOfferType,
    );
    const offerSource = normalizeOfferSourceForAnalytics(record.offerSource);

    summary.acceptanceByOfferType[acceptedOfferType] =
      (summary.acceptanceByOfferType[acceptedOfferType] ?? 0) + 1;
    summary.acceptanceBySource[offerSource] =
      (summary.acceptanceBySource[offerSource] ?? 0) + 1;

    switch (acceptedOfferType) {
      case "EXCHANGE":
        summary.acceptedExchangeCount += 1;
        break;
      case "STORE_CREDIT":
        summary.acceptedStoreCreditCount += 1;
        break;
      case "PARTIAL_REFUND":
        summary.acceptedPartialRefundCount += 1;
        break;
      case "LEGAL_REVIEW_REQUIRED":
        summary.legalReviewRequiredCount += 1;
        break;
      default:
        summary.manualReviewCount += 1;
        break;
    }

    if (
      record.legalReviewRequired === true ||
      acceptedOfferType === "LEGAL_REVIEW_REQUIRED" ||
      acceptedOfferType === "MANUAL_REVIEW" ||
      !RECOVERY_ELIGIBLE_TYPES.has(acceptedOfferType)
    ) {
      continue;
    }

    summary.estimatedRecoveredAmountCents += normalizeRecoveryAmountCents(
      record.recoveryAmountCents,
    );
  }

  summary.estimatedRecoveredAmountDisplay = formatRecoveredAmountDisplay(
    summary.estimatedRecoveredAmountCents,
    currency,
  );

  return summary;
}

/**
 * @param {import("@prisma/client").PrismaClient | Record<string, unknown>} prismaClient
 * @param {string} merchantId
 */
export async function loadMerchantOfferAcceptances(prismaClient, merchantId) {
  return prismaClient.returnOfferAcceptance.findMany({
    where: { merchantId: String(merchantId) },
    select: {
      id: true,
      merchantId: true,
      returnRequestId: true,
      returnItemId: true,
      originalRequestedOption: true,
      acceptedOfferType: true,
      offerSource: true,
      recoveryAmountCents: true,
      currency: true,
      legalReviewRequired: true,
      acceptedAt: true,
    },
  });
}

/**
 * @param {Array<Record<string, unknown>>} acceptances
 */
export function buildOfferAcceptanceByReturnItemId(acceptances) {
  const map = new Map();

  for (const record of dedupeOfferAcceptancesByReturnItemId(acceptances)) {
    if (record.returnItemId) {
      map.set(String(record.returnItemId), record);
    }
  }

  return map;
}
