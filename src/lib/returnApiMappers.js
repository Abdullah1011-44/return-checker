/** Form values ↔ Prisma enums for API routes */

export const RETURN_REASON_MAP = {
  wrong_size: "WRONG_SIZE",
  wrong_color: "WRONG_COLOR",
  damaged_item: "DAMAGED_ITEM",
  wrong_item: "WRONG_ITEM",
  changed_mind: "CHANGED_MIND",
  quality_issue: "QUALITY_ISSUE",
  late_delivery: "LATE_DELIVERY",
  other: "OTHER",
};

export const RECOVERY_OPTION_MAP = {
  "Exchange Product": "EXCHANGE",
  "Store Credit": "STORE_CREDIT",
  "Partial Refund": "PARTIAL_REFUND",
  "Discount to Keep": "DISCOUNT_TO_KEEP",
  "Full Refund": "FULL_REFUND",
  "Manual Review": "MANUAL_REVIEW",
};

export function normalizeOrderNumber(orderNumber) {
  return orderNumber.replace("#", "").trim();
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function mapReturnReason(reason) {
  return RETURN_REASON_MAP[reason] ?? "OTHER";
}

export function mapRecoveryOption(selectedOption) {
  return RECOVERY_OPTION_MAP[selectedOption] ?? "MANUAL_REVIEW";
}

export function guessImageMimeType(proofImage) {
  if (!proofImage?.startsWith("data:")) return null;
  const match = proofImage.match(/^data:([^;]+);/);
  return match?.[1] ?? null;
}
