/**
 * Offer acceptance tracking (Task 36).
 * Records which recovery offer a customer or merchant actually accepted per return item.
 * Analytics/tracking only — no Shopify refunds, exchanges, or payments.
 */
import { prisma } from "@/lib/prisma";

export const ACCEPTED_OFFER_TYPES = [
  "EXCHANGE",
  "STORE_CREDIT",
  "PARTIAL_REFUND",
  "MANUAL_REVIEW",
  "LEGAL_REVIEW_REQUIRED",
];

export const OFFER_SOURCES = [
  "CUSTOMER_SELECTED",
  "RULE_ENGINE",
  "FOLLOW_UP_ENGINE",
  "MERCHANT_MANUAL",
  "SYSTEM_DEFAULT",
];

const AI_OFFER_SOURCE_ALIASES = new Set([
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
  DISCOUNT_TO_KEEP: "MANUAL_REVIEW",
  FULL_REFUND: "MANUAL_REVIEW",
};

const OFFER_SOURCE_ALIASES = {
  CUSTOMER_SELECTED: "CUSTOMER_SELECTED",
  CUSTOMER: "CUSTOMER_SELECTED",
  RULE_ENGINE: "RULE_ENGINE",
  RULE: "RULE_ENGINE",
  FOLLOW_UP_ENGINE: "FOLLOW_UP_ENGINE",
  FOLLOW_UP: "FOLLOW_UP_ENGINE",
  FOLLOW_UP_QUESTION: "FOLLOW_UP_ENGINE",
  MERCHANT_MANUAL: "MERCHANT_MANUAL",
  MERCHANT: "MERCHANT_MANUAL",
  SYSTEM_DEFAULT: "SYSTEM_DEFAULT",
  SYSTEM: "SYSTEM_DEFAULT",
  DEFAULT: "SYSTEM_DEFAULT",
};

const UNSAFE_METADATA_KEY_PATTERN =
  /(token|secret|password|authorization|cookie|api[_-]?key|access[_-]?token|shopify|proofimage|imageurl|rawimage|email|phone|address|customername|customeremail|creditcard|cvv|ssn|passport)/i;

const SAFE_METADATA_KEYS = new Set([
  "reason",
  "risklevel",
  "decisioncode",
  "ladderposition",
  "followupsummary",
  "ruleversion",
  "reasoncode",
  "decision",
  "recommendation",
  "exclusionreason",
  "policyreason",
  "missingitempricereason",
  "recoverycalculation",
  "recoverydecision",
  "legalreviewrequired",
  "trustedrecoveryamountunavailable",
]);

export class OfferAcceptanceValidationError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "OfferAcceptanceValidationError";
    this.field = field;
  }
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeOfferType(value) {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return "MANUAL_REVIEW";
  }

  if (OFFER_TYPE_ALIASES[normalized]) {
    return OFFER_TYPE_ALIASES[normalized];
  }

  if (ACCEPTED_OFFER_TYPES.includes(normalized)) {
    return normalized;
  }

  return "MANUAL_REVIEW";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeOfferSource(value) {
  const normalized = normalizeToken(value);
  if (!normalized) {
    return "SYSTEM_DEFAULT";
  }

  if (AI_OFFER_SOURCE_ALIASES.has(normalized)) {
    return "SYSTEM_DEFAULT";
  }

  if (OFFER_SOURCE_ALIASES[normalized]) {
    return OFFER_SOURCE_ALIASES[normalized];
  }

  if (OFFER_SOURCES.includes(normalized)) {
    return normalized;
  }

  return "SYSTEM_DEFAULT";
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseAmountToCents(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && Math.abs(value) >= 100) {
      return Math.max(0, Math.round(value));
    }
    return Math.max(0, Math.round(value * 100));
  }

  const raw =
    typeof value === "object" &&
    value !== null &&
    typeof value.toString === "function"
      ? value.toString()
      : String(value);
  const parsed = Number.parseFloat(raw.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.round(parsed * 100));
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function parseCentsValue(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  return parseAmountToCents(value);
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 * @returns {{ cents: number; reason?: string }}
 */
function resolveItemPricePaidCents(item) {
  if (!item || typeof item !== "object") {
    return { cents: 0, reason: "missing_item_price" };
  }

  if (item.pricePaidCents != null) {
    const cents = parseAmountToCents(item.pricePaidCents);
    if (cents != null) {
      return { cents };
    }
  }

  if (item.linePriceCents != null) {
    const cents = parseAmountToCents(item.linePriceCents);
    if (cents != null) {
      return { cents };
    }
  }

  const unitPriceCents = parseAmountToCents(item.price);
  if (unitPriceCents == null) {
    return { cents: 0, reason: "missing_item_price" };
  }

  const quantity = Number(item.quantity);
  const multiplier =
    Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;

  return { cents: unitPriceCents * multiplier };
}

/**
 * @param {{
 *   item?: Record<string, unknown> | null;
 *   acceptedOfferType: string;
 *   originalRequestedOption?: string | null;
 *   partialRefundAmountCents?: number | null;
 *   storeCreditBonusCents?: number | null;
 * }} input
 * @returns {{ recoveryAmountCents: number; metadata?: Record<string, unknown> }}
 */
export function calculateRecoveryAmountCents({
  item = null,
  acceptedOfferType,
  originalRequestedOption = null,
  partialRefundAmountCents = null,
  storeCreditBonusCents = null,
}) {
  const normalizedType = normalizeOfferType(acceptedOfferType);
  const { cents: itemPricePaidCents, reason: missingItemPriceReason } =
    resolveItemPricePaidCents(item);
  const metadata = {};

  if (missingItemPriceReason) {
    metadata.missingItemPriceReason = missingItemPriceReason;
  }

  if (originalRequestedOption != null && originalRequestedOption !== "") {
    metadata.originalRequestedOption = String(originalRequestedOption);
  }

  if (
    normalizedType === "MANUAL_REVIEW" ||
    normalizedType === "LEGAL_REVIEW_REQUIRED"
  ) {
    return {
      recoveryAmountCents: 0,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  }

  if (itemPricePaidCents <= 0) {
    return {
      recoveryAmountCents: 0,
      metadata: {
        ...metadata,
        recoveryCalculation: "zero_item_price",
      },
    };
  }

  switch (normalizedType) {
    case "EXCHANGE":
      return {
        recoveryAmountCents: itemPricePaidCents,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    case "STORE_CREDIT": {
      const bonusCents = parseCentsValue(storeCreditBonusCents) ?? 0;
      return {
        recoveryAmountCents: Math.max(itemPricePaidCents - bonusCents, 0),
        metadata: {
          ...metadata,
          recoveryCalculation: "store_credit_bonus_subtracted",
          storeCreditBonusCents: bonusCents,
        },
      };
    }
    case "PARTIAL_REFUND": {
      const refundCents = parseCentsValue(partialRefundAmountCents) ?? 0;
      return {
        recoveryAmountCents: Math.max(itemPricePaidCents - refundCents, 0),
        metadata: {
          ...metadata,
          recoveryCalculation: "partial_refund_subtracted",
          partialRefundAmountCents: refundCents,
        },
      };
    }
    default:
      return {
        recoveryAmountCents: 0,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
  }
}

function isUnsafeMetadataKey(key) {
  const normalized = String(key).trim().toLowerCase();
  if (SAFE_METADATA_KEYS.has(normalized)) {
    return false;
  }
  return UNSAFE_METADATA_KEY_PATTERN.test(normalized);
}

function sanitizeMetadataValue(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return "[redacted:image]";
    }
    if (value.length > 500) {
      return `${value.slice(0, 500)}…`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((entry) => sanitizeMetadataValue(entry))
      .filter((entry) => entry != null);
  }

  if (typeof value === "object") {
    return sanitizeOfferAcceptanceMetadata(value);
  }

  return value;
}

/**
 * @param {unknown} metadata
 * @returns {Record<string, unknown> | null}
 */
export function sanitizeOfferAcceptanceMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (isUnsafeMetadataKey(key)) {
      continue;
    }

    const cleaned = sanitizeMetadataValue(value);
    if (cleaned != null) {
      sanitized[key] = cleaned;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function assertRequiredString(value, field) {
  if (value == null || String(value).trim() === "") {
    throw new OfferAcceptanceValidationError(`${field} is required`, field);
  }
}

function mergeMetadata(...sources) {
  const merged = {};

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (value != null) {
        merged[key] = value;
      }
    }
  }

  return sanitizeOfferAcceptanceMetadata(merged);
}

/**
 * @param {{
 *   merchantId: string;
 *   returnRequestId: string;
 *   returnItemId: string;
 *   originalRequestedOption?: string | null;
 *   acceptedOfferType: string;
 *   offerSource: string;
 *   currency?: string | null;
 *   recoveryAmountCents?: number | null;
 *   legalReviewRequired?: boolean;
 *   acceptedAt?: Date | string | null;
 *   metadata?: Record<string, unknown> | null;
 *   item?: Record<string, unknown> | null;
 *   partialRefundAmountCents?: number | null;
 *   storeCreditBonusCents?: number | null;
 *   prismaClient?: typeof prisma;
 * }} input
 */
export async function recordOfferAcceptance({
  merchantId,
  returnRequestId,
  returnItemId,
  originalRequestedOption = null,
  acceptedOfferType,
  offerSource,
  currency = "AUD",
  recoveryAmountCents = null,
  legalReviewRequired = false,
  acceptedAt = null,
  metadata = null,
  item = null,
  partialRefundAmountCents = null,
  storeCreditBonusCents = null,
  prismaClient = prisma,
}) {
  assertRequiredString(merchantId, "merchantId");
  assertRequiredString(returnRequestId, "returnRequestId");
  assertRequiredString(returnItemId, "returnItemId");

  const normalizedSource = normalizeOfferSource(offerSource);
  let normalizedOfferType = normalizeOfferType(acceptedOfferType);
  const legalReview = legalReviewRequired === true;

  if (legalReview) {
    normalizedOfferType = "LEGAL_REVIEW_REQUIRED";
  }

  const calculation = calculateRecoveryAmountCents({
    item,
    acceptedOfferType: normalizedOfferType,
    originalRequestedOption,
    partialRefundAmountCents,
    storeCreditBonusCents,
  });

  const resolvedRecoveryAmountCents = legalReview
    ? 0
    : recoveryAmountCents != null
      ? Math.max(0, Math.round(Number(recoveryAmountCents)))
      : calculation.recoveryAmountCents;

  const resolvedAcceptedAt =
    acceptedAt instanceof Date
      ? acceptedAt
      : acceptedAt
        ? new Date(acceptedAt)
        : new Date();

  const resolvedMetadata = mergeMetadata(
    metadata,
    calculation.metadata ?? null,
    legalReview ? { legalReviewRequired: true } : null,
  );

  const data = {
    merchantId: String(merchantId).trim(),
    returnRequestId: String(returnRequestId).trim(),
    returnItemId: String(returnItemId).trim(),
    originalRequestedOption:
      originalRequestedOption != null && originalRequestedOption !== ""
        ? String(originalRequestedOption)
        : null,
    acceptedOfferType: normalizedOfferType,
    offerSource: normalizedSource,
    recoveryAmountCents: resolvedRecoveryAmountCents,
    currency: currency ? String(currency).trim().toUpperCase() : "AUD",
    legalReviewRequired: legalReview,
    acceptedAt: resolvedAcceptedAt,
    metadata: resolvedMetadata,
  };

  return prismaClient.returnOfferAcceptance.upsert({
    where: { returnItemId: data.returnItemId },
    create: data,
    update: {
      originalRequestedOption: data.originalRequestedOption,
      acceptedOfferType: data.acceptedOfferType,
      offerSource: data.offerSource,
      recoveryAmountCents: data.recoveryAmountCents,
      currency: data.currency,
      legalReviewRequired: data.legalReviewRequired,
      acceptedAt: data.acceptedAt,
      metadata: data.metadata,
    },
  });
}
