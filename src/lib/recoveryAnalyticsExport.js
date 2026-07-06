/**
 * Recovery analytics CSV export (Task 37 Prompt 6).
 * Uses persisted recoveryAmountCents snapshots only — never live product prices.
 */
import {
  ACCEPTED_OFFER_TYPE_LABELS,
  formatRecoveredAmountDisplay,
} from "@/lib/offerAcceptanceAnalytics";
import {
  filterAcceptancesForMerchant,
  getAcceptedOfferType,
  getSydneyAnalyticsRangeBounds,
  isAcceptedRecoveryOffer,
  isInstantWithinRange,
  parseRecoveryAnalyticsRange,
  RECOVERY_ANALYTICS_TIMEZONE,
} from "@/lib/recoveryAnalytics";

export const RECOVERY_EXPORT_CSV_HEADERS = [
  "Accepted Date",
  "Order",
  "Product",
  "Offer Type",
  "Reason",
  "Estimated Refund Avoided",
];

const REASON_LABELS = {
  wrong_size: "Wrong size",
  damaged_item: "Damaged item",
  changed_mind: "Changed mind",
  late_delivery: "Late delivery",
  other: "Other",
};

/**
 * @param {unknown} value
 */
export function sanitizeCsvFormulaInjection(value) {
  const text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) {
    return `'${text}`;
  }
  return text;
}

/**
 * @param {unknown} value
 */
export function escapeCsvCell(value) {
  const sanitized = sanitizeCsvFormulaInjection(value);
  if (/[",\n\r]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/**
 * @param {unknown} cents
 */
export function formatRecoveryExportAudAmount(cents) {
  return formatRecoveredAmountDisplay(cents, "AUD");
}

/**
 * @param {Date | string | null | undefined} acceptedAt
 */
export function formatRecoveryExportAcceptedDate(acceptedAt) {
  const instant =
    acceptedAt instanceof Date ? acceptedAt : new Date(acceptedAt ?? "");
  if (Number.isNaN(instant.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-AU", {
    timeZone: RECOVERY_ANALYTICS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(instant);
}

/**
 * @param {unknown} reason
 */
export function formatRecoveryExportReason(reason) {
  const normalized = String(reason ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "Unknown";
  }

  return REASON_LABELS[normalized] ?? normalized.replace(/_/g, " ");
}

/**
 * @param {Record<string, unknown>} acceptance
 */
export function mapAcceptanceToExportRow(acceptance) {
  const offerType = getAcceptedOfferType(acceptance);
  const metadata =
    acceptance?.metadata && typeof acceptance.metadata === "object"
      ? acceptance.metadata
      : null;
  const returnItem =
    acceptance?.returnItem && typeof acceptance.returnItem === "object"
      ? acceptance.returnItem
      : null;
  const orderItem =
    returnItem?.orderItem && typeof returnItem.orderItem === "object"
      ? returnItem.orderItem
      : null;
  const returnRequest =
    acceptance?.returnRequest && typeof acceptance.returnRequest === "object"
      ? acceptance.returnRequest
      : null;
  const order =
    returnRequest?.order && typeof returnRequest.order === "object"
      ? returnRequest.order
      : null;

  const productName = orderItem?.productName ?? "Unknown product";
  const sku = orderItem?.sku ? String(orderItem.sku) : "";
  const product = sku ? `${productName} (${sku})` : String(productName);

  return {
    acceptedDate: formatRecoveryExportAcceptedDate(acceptance.acceptedAt),
    order: order?.orderNumber != null ? String(order.orderNumber) : "",
    product,
    offerType: ACCEPTED_OFFER_TYPE_LABELS[offerType] ?? offerType,
    reason: formatRecoveryExportReason(metadata?.reason ?? returnItem?.reason),
    estimatedRefundAvoided: formatRecoveryExportAudAmount(
      acceptance.recoveryAmountCents,
    ),
  };
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} acceptances
 * @param {{
 *   startInclusive: Date;
 *   endExclusive: Date;
 * }} bounds
 * @param {{ merchantId?: string }} [options]
 */
export function buildRecoveryExportRows(acceptances, bounds, options = {}) {
  const scoped = options.merchantId
    ? filterAcceptancesForMerchant(acceptances, options.merchantId)
    : Array.isArray(acceptances)
      ? acceptances
      : [];

  return scoped
    .filter((acceptance) => isAcceptedRecoveryOffer(acceptance))
    .filter((acceptance) =>
      isInstantWithinRange(
        acceptance.acceptedAt,
        bounds.startInclusive,
        bounds.endExclusive,
      ),
    )
    .sort((left, right) => {
      const rightMs = new Date(right.acceptedAt ?? 0).getTime();
      const leftMs = new Date(left.acceptedAt ?? 0).getTime();
      return rightMs - leftMs;
    })
    .map((acceptance) => mapAcceptanceToExportRow(acceptance));
}

/**
 * @param {Array<Record<string, string>>} rows
 */
export function buildRecoveryExportCsv(rows) {
  const lines = [
    RECOVERY_EXPORT_CSV_HEADERS.map((header) => escapeCsvCell(header)).join(
      ",",
    ),
    ...rows.map((row) =>
      [
        row.acceptedDate,
        row.order,
        row.product,
        row.offerType,
        row.reason,
        row.estimatedRefundAvoided,
      ]
        .map((value) => escapeCsvCell(value))
        .join(","),
    ),
  ];

  return `${lines.join("\r\n")}\r\n`;
}

/**
 * @param {import("@prisma/client").PrismaClient | Record<string, unknown>} prismaClient
 * @param {string} merchantId
 * @param {{ range?: string; now?: Date }} [options]
 */
export async function loadMerchantRecoveryExportCsv(
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
      recoveryAmountCents: true,
      legalReviewRequired: true,
      acceptedAt: true,
      metadata: true,
      returnRequest: {
        select: {
          order: {
            select: {
              orderNumber: true,
            },
          },
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

  const rows = buildRecoveryExportRows(acceptances, bounds, {
    merchantId: scopedMerchantId,
  });

  return {
    range,
    timezone: RECOVERY_ANALYTICS_TIMEZONE,
    bounds,
    rows,
    csv: buildRecoveryExportCsv(rows),
  };
}
