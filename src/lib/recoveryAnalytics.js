/**
 * Period-aware recovery analytics (Task 37).
 * Uses persisted ReturnOfferAcceptance.recoveryAmountCents snapshots only —
 * never recalculates from live product/order prices.
 */
import {
  ACCEPTED_OFFER_TYPE_LABELS,
  dedupeOfferAcceptancesByReturnItemId,
  normalizeAcceptedOfferTypeForAnalytics,
  normalizeRecoveryAmountCents,
} from "@/lib/offerAcceptanceAnalytics";

export const RECOVERY_ANALYTICS_TIMEZONE = "Australia/Sydney";

export const RECOVERY_ANALYTICS_RANGES = ["7d", "30d", "90d"];

export const DEFAULT_RECOVERY_ANALYTICS_RANGE = "30d";

const RECOVERY_OFFER_TYPES = new Set([
  "EXCHANGE",
  "STORE_CREDIT",
  "PARTIAL_REFUND",
]);

const SMALL_SAMPLE_DENOMINATOR_THRESHOLD = 10;

/**
 * @param {unknown} value
 * @returns {"7d" | "30d" | "90d"}
 */
export function parseRecoveryAnalyticsRange(value) {
  const normalized = String(value ?? DEFAULT_RECOVERY_ANALYTICS_RANGE)
    .trim()
    .toLowerCase();

  if (RECOVERY_ANALYTICS_RANGES.includes(normalized)) {
    return /** @type {"7d" | "30d" | "90d"} */ (normalized);
  }

  return DEFAULT_RECOVERY_ANALYTICS_RANGE;
}

/**
 * @param {"7d" | "30d" | "90d"} rangeKey
 */
export function getRecoveryAnalyticsRangeDays(rangeKey) {
  switch (parseRecoveryAnalyticsRange(rangeKey)) {
    case "7d":
      return 7;
    case "90d":
      return 90;
    default:
      return 30;
  }
}

/**
 * @param {Date} date
 * @param {string} [timeZone]
 */
function getZonedDateParts(date, timeZone = RECOVERY_ANALYTICS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }

  return values;
}

/**
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @param {string} [timeZone]
 */
function zonedMidnightUtc(
  year,
  month,
  day,
  timeZone = RECOVERY_ANALYTICS_TIMEZONE,
) {
  const target = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  let low = Date.UTC(year, month - 1, day - 1, 0, 0, 0);
  let high = Date.UTC(year, month - 1, day + 1, 23, 59, 59);

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const parts = getZonedDateParts(new Date(mid), timeZone);
    const current = `${parts.year}-${parts.month}-${parts.day}`;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);

    if (current < target) {
      low = mid + 1;
      continue;
    }

    if (current > target || minutes > 0) {
      high = mid;
      continue;
    }

    return new Date(mid);
  }

  return new Date(low);
}

/**
 * @param {Date} date
 * @param {number} dayOffset
 * @param {string} [timeZone]
 */
function addSydneyCalendarDays(
  date,
  dayOffset,
  timeZone = RECOVERY_ANALYTICS_TIMEZONE,
) {
  const parts = getZonedDateParts(date, timeZone);
  const anchor = zonedMidnightUtc(
    Number(parts.year),
    Number(parts.month),
    Number(parts.day),
    timeZone,
  );

  return new Date(anchor.getTime() + dayOffset * 24 * 60 * 60 * 1000);
}

/**
 * Inclusive Sydney calendar-day bounds for the selected rolling window.
 *
 * @param {"7d" | "30d" | "90d"} rangeKey
 * @param {Date} [now]
 */
export function getSydneyAnalyticsRangeBounds(rangeKey, now = new Date()) {
  const days = getRecoveryAnalyticsRangeDays(rangeKey);
  const todayParts = getZonedDateParts(now);
  const endExclusive = addSydneyCalendarDays(now, 1);
  const startInclusive = addSydneyCalendarDays(
    zonedMidnightUtc(
      Number(todayParts.year),
      Number(todayParts.month),
      Number(todayParts.day),
    ),
    -(days - 1),
  );

  return {
    range: parseRecoveryAnalyticsRange(rangeKey),
    timezone: RECOVERY_ANALYTICS_TIMEZONE,
    startInclusive,
    endExclusive,
    days,
  };
}

/**
 * @param {Date | string | null | undefined} value
 * @param {Date} startInclusive
 * @param {Date} endExclusive
 */
export function isInstantWithinRange(value, startInclusive, endExclusive) {
  if (!value) {
    return false;
  }

  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return false;
  }

  return instant >= startInclusive && instant < endExclusive;
}

/**
 * @param {Date} instant
 * @param {string} [timeZone]
 */
export function toSydneyDateKey(
  instant,
  timeZone = RECOVERY_ANALYTICS_TIMEZONE,
) {
  const parts = getZonedDateParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * @param {Record<string, unknown>} acceptance
 */
export function getAcceptedOfferType(acceptance) {
  return normalizeAcceptedOfferTypeForAnalytics(acceptance?.acceptedOfferType);
}

/**
 * @param {Record<string, unknown>} acceptance
 */
export function isLegalReviewAcceptance(acceptance) {
  return (
    acceptance?.legalReviewRequired === true ||
    getAcceptedOfferType(acceptance) === "LEGAL_REVIEW_REQUIRED"
  );
}

/**
 * @param {Record<string, unknown>} acceptance
 */
export function isManualReviewAcceptance(acceptance) {
  return getAcceptedOfferType(acceptance) === "MANUAL_REVIEW";
}

/**
 * Accepted recovery offers included in refund-avoided totals.
 * @param {Record<string, unknown>} acceptance
 */
export function isAcceptedRecoveryOffer(acceptance) {
  if (
    isLegalReviewAcceptance(acceptance) ||
    isManualReviewAcceptance(acceptance)
  ) {
    return false;
  }

  return RECOVERY_OFFER_TYPES.has(getAcceptedOfferType(acceptance));
}

/**
 * V1 ladder-eligible denominator rows: non-manual, non-legal acceptance records.
 * Future improvement: persist offerLadderEnteredAt and productExcluded for stricter eligibility.
 *
 * @param {Record<string, unknown>} acceptance
 */
export function isLadderEligibleAcceptance(acceptance) {
  return (
    !isLegalReviewAcceptance(acceptance) &&
    !isManualReviewAcceptance(acceptance)
  );
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} acceptances
 * @param {string} merchantId
 */
export function filterAcceptancesForMerchant(acceptances, merchantId) {
  if (!Array.isArray(acceptances) || !merchantId) {
    return [];
  }

  const scopedMerchantId = String(merchantId).trim();
  return dedupeOfferAcceptancesByReturnItemId(
    acceptances.filter(
      (record) => String(record?.merchantId ?? "").trim() === scopedMerchantId,
    ),
  );
}

/**
 * @param {Record<string, unknown>} acceptance
 * @param {Map<string, Date | string> | Record<string, Date | string> | null | undefined} submittedAtByRequestId
 */
function getSubmittedAtForAcceptance(acceptance, submittedAtByRequestId) {
  const returnRequestId = acceptance?.returnRequestId;
  if (!returnRequestId || !submittedAtByRequestId) {
    return null;
  }

  if (submittedAtByRequestId instanceof Map) {
    return submittedAtByRequestId.get(String(returnRequestId)) ?? null;
  }

  return submittedAtByRequestId[String(returnRequestId)] ?? null;
}

/**
 * @param {Record<string, unknown>} acceptance
 * @param {Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>> | null | undefined} returnItemById
 */
function getReturnItemContext(acceptance, returnItemById) {
  const returnItemId = acceptance?.returnItemId;
  if (!returnItemId || !returnItemById) {
    return null;
  }

  if (returnItemById instanceof Map) {
    return returnItemById.get(String(returnItemId)) ?? null;
  }

  return returnItemById[String(returnItemId)] ?? null;
}

function resolveReasonKey(acceptance, returnItemById) {
  const metadata =
    acceptance?.metadata && typeof acceptance.metadata === "object"
      ? acceptance.metadata
      : null;
  const returnItem = getReturnItemContext(acceptance, returnItemById);
  const rawReason =
    metadata?.reason ??
    returnItem?.reason ??
    returnItem?.returnReason ??
    "unknown";

  return String(rawReason).trim().toLowerCase() || "unknown";
}

function resolveProductKey(acceptance, returnItemById) {
  const returnItem = getReturnItemContext(acceptance, returnItemById);
  const orderItem =
    returnItem?.orderItem && typeof returnItem.orderItem === "object"
      ? returnItem.orderItem
      : null;

  const sku = orderItem?.sku ?? returnItem?.sku ?? "";
  const productName =
    orderItem?.productName ?? returnItem?.productName ?? "Unknown product";

  return {
    key: sku ? String(sku) : String(productName),
    productName: String(productName),
    sku: sku ? String(sku) : "",
  };
}

function incrementMapCount(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function incrementMapCents(map, key, cents) {
  map.set(key, (map.get(key) ?? 0) + normalizeRecoveryAmountCents(cents));
}

function buildTrendBuckets(startInclusive, endExclusive) {
  const buckets = [];
  let cursor = new Date(startInclusive);

  while (cursor < endExclusive) {
    buckets.push({
      date: toSydneyDateKey(cursor),
      estimatedRefundAvoidedCents: 0,
      acceptedRecoveryOffers: 0,
    });
    cursor = addSydneyCalendarDays(cursor, 1);
  }

  return buckets;
}

function finalizeTopList(countMap, centsMap, labelMap, limit = 5) {
  return Array.from(countMap.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return (centsMap.get(right[0]) ?? 0) - (centsMap.get(left[0]) ?? 0);
    })
    .slice(0, limit)
    .map(([key, count]) => ({
      key,
      label: labelMap.get(key) ?? key,
      count,
      estimatedRefundAvoidedCents: centsMap.get(key) ?? 0,
    }));
}

/**
 * @param {{
 *   merchantId: string;
 *   acceptances?: Array<Record<string, unknown>> | null;
 *   submittedAtByRequestId?: Map<string, Date | string> | Record<string, Date | string> | null;
 *   returnItemById?: Map<string, Record<string, unknown>> | Record<string, Record<string, unknown>> | null;
 *   range?: string;
 *   now?: Date;
 * }} input
 */
export function buildRecoveryAnalytics(input) {
  const {
    merchantId,
    acceptances = [],
    submittedAtByRequestId = null,
    returnItemById = null,
    range = DEFAULT_RECOVERY_ANALYTICS_RANGE,
    now = new Date(),
  } = input ?? {};

  const rangeKey = parseRecoveryAnalyticsRange(range);
  const bounds = getSydneyAnalyticsRangeBounds(rangeKey, now);
  const scopedAcceptances = filterAcceptancesForMerchant(
    acceptances,
    merchantId,
  );

  let estimatedRefundAvoidedCents = 0;
  let acceptedRecoveryOffers = 0;
  let ladderEligibleDenominator = 0;

  const offerTypeCounts = new Map();
  const offerTypeCents = new Map();
  const reasonCounts = new Map();
  const reasonCents = new Map();
  const reasonLabels = new Map();
  const productCounts = new Map();
  const productCents = new Map();
  const productLabels = new Map();

  const trendBuckets = buildTrendBuckets(
    bounds.startInclusive,
    bounds.endExclusive,
  );
  const trendByDate = new Map(
    trendBuckets.map((bucket) => [bucket.date, bucket]),
  );

  for (const acceptance of scopedAcceptances) {
    const offerType = getAcceptedOfferType(acceptance);
    const recoveryCents = normalizeRecoveryAmountCents(
      acceptance.recoveryAmountCents,
    );
    const acceptedAt = acceptance.acceptedAt;
    const submittedAt = getSubmittedAtForAcceptance(
      acceptance,
      submittedAtByRequestId,
    );

    const inAcceptedAtRange = isInstantWithinRange(
      acceptedAt,
      bounds.startInclusive,
      bounds.endExclusive,
    );
    const inSubmittedAtRange = isInstantWithinRange(
      submittedAt,
      bounds.startInclusive,
      bounds.endExclusive,
    );

    // V1 denominator proxy: ReturnRequest.submittedAt stands in for offer ladder entry.
    // Future improvement: offerLadderEnteredAt and productExcluded on acceptance rows.
    if (isLadderEligibleAcceptance(acceptance) && inSubmittedAtRange) {
      ladderEligibleDenominator += 1;
    }

    if (isAcceptedRecoveryOffer(acceptance) && inAcceptedAtRange) {
      acceptedRecoveryOffers += 1;
      estimatedRefundAvoidedCents += recoveryCents;

      incrementMapCount(offerTypeCounts, offerType);
      incrementMapCents(offerTypeCents, offerType, recoveryCents);

      const reasonKey = resolveReasonKey(acceptance, returnItemById);
      incrementMapCount(reasonCounts, reasonKey);
      incrementMapCents(reasonCents, reasonKey, recoveryCents);
      reasonLabels.set(reasonKey, reasonKey);

      const product = resolveProductKey(acceptance, returnItemById);
      incrementMapCount(productCounts, product.key);
      incrementMapCents(productCents, product.key, recoveryCents);
      productLabels.set(
        product.key,
        product.sku
          ? `${product.productName} (${product.sku})`
          : product.productName,
      );

      const trendDate = toSydneyDateKey(
        acceptedAt instanceof Date ? acceptedAt : new Date(acceptedAt),
      );
      const trendBucket = trendByDate.get(trendDate);
      if (trendBucket) {
        trendBucket.acceptedRecoveryOffers += 1;
        trendBucket.estimatedRefundAvoidedCents += recoveryCents;
      }
    }
  }

  const recoveryRate =
    ladderEligibleDenominator > 0
      ? acceptedRecoveryOffers / ladderEligibleDenominator
      : 0;

  const averageRecoveryValueCents =
    acceptedRecoveryOffers > 0
      ? Math.round(estimatedRefundAvoidedCents / acceptedRecoveryOffers)
      : 0;

  const pendingOfferDecisions = scopedAcceptances.filter(
    (acceptance) =>
      isManualReviewAcceptance(acceptance) ||
      isLegalReviewAcceptance(acceptance),
  ).length;

  const offerTypes = ["EXCHANGE", "STORE_CREDIT", "PARTIAL_REFUND"].map(
    (type) => ({
      type,
      label: ACCEPTED_OFFER_TYPE_LABELS[type] ?? type,
      count: offerTypeCounts.get(type) ?? 0,
      estimatedRefundAvoidedCents: offerTypeCents.get(type) ?? 0,
    }),
  );

  return {
    range: bounds.range,
    timezone: bounds.timezone,
    period: {
      startInclusive: bounds.startInclusive.toISOString(),
      endExclusive: bounds.endExclusive.toISOString(),
    },
    summary: {
      estimatedRefundAvoidedCents,
      acceptedRecoveryOffers,
      recoveryRate,
      averageRecoveryValueCents,
      pendingOfferDecisions,
      smallSampleCaveat:
        ladderEligibleDenominator < SMALL_SAMPLE_DENOMINATOR_THRESHOLD,
      ladderEligibleDenominator,
    },
    trend: trendBuckets,
    offerTypes,
    funnel: [
      {
        stage: "ladder_eligible",
        label: "Ladder eligible (submitted in period)",
        count: ladderEligibleDenominator,
      },
      {
        stage: "accepted_recovery",
        label: "Accepted recovery offer (accepted in period)",
        count: acceptedRecoveryOffers,
      },
    ],
    topReasons: finalizeTopList(reasonCounts, reasonCents, reasonLabels),
    topProducts: finalizeTopList(productCounts, productCents, productLabels),
  };
}

/**
 * Merchant-scoped loader for GET /api/dashboard/recovery (future route).
 *
 * @param {import("@prisma/client").PrismaClient | Record<string, unknown>} prismaClient
 * @param {string} merchantId
 * @param {{ range?: string; now?: Date }} [options]
 */
export async function loadMerchantRecoveryAnalytics(
  prismaClient,
  merchantId,
  options = {},
) {
  const scopedMerchantId = String(merchantId).trim();
  const range = parseRecoveryAnalyticsRange(options.range);
  const now = options.now ?? new Date();
  const bounds = getSydneyAnalyticsRangeBounds(range, now);

  const acceptances = await prismaClient.returnOfferAcceptance.findMany({
    where: { merchantId: scopedMerchantId },
    select: {
      id: true,
      merchantId: true,
      returnRequestId: true,
      returnItemId: true,
      acceptedOfferType: true,
      offerSource: true,
      recoveryAmountCents: true,
      currency: true,
      legalReviewRequired: true,
      acceptedAt: true,
      metadata: true,
      returnRequest: {
        select: {
          submittedAt: true,
        },
      },
      returnItem: {
        select: {
          reason: true,
          orderItem: {
            select: {
              productName: true,
              sku: true,
            },
          },
        },
      },
    },
  });

  const normalizedAcceptances = acceptances.map((record) => ({
    ...record,
    metadata: record.metadata ?? null,
  }));

  const submittedAtByRequestId = Object.fromEntries(
    acceptances.map((record) => [
      record.returnRequestId,
      record.returnRequest?.submittedAt ?? null,
    ]),
  );

  const returnItemById = Object.fromEntries(
    acceptances.map((record) => [
      record.returnItemId,
      {
        reason: record.returnItem?.reason ?? null,
        orderItem: record.returnItem?.orderItem ?? null,
      },
    ]),
  );

  const analytics = buildRecoveryAnalytics({
    merchantId: scopedMerchantId,
    acceptances: normalizedAcceptances,
    submittedAtByRequestId,
    returnItemById,
    range,
    now,
  });

  return {
    ...analytics,
    queryWindow: {
      submittedAtGte: bounds.startInclusive,
      submittedAtLt: bounds.endExclusive,
      acceptedAtGte: bounds.startInclusive,
      acceptedAtLt: bounds.endExclusive,
    },
  };
}
