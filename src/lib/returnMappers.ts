import type {
  EligibilityStatus,
  RecoveryOption,
  ReturnReason,
} from "@prisma/client";

/** Customer form reason codes → Prisma ReturnReason */
const RETURN_REASON_MAP: Record<string, ReturnReason> = {
  wrong_size: "WRONG_SIZE",
  wrong_color: "WRONG_COLOR",
  damaged_item: "DAMAGED_ITEM",
  wrong_item: "WRONG_ITEM",
  changed_mind: "CHANGED_MIND",
  quality_issue: "QUALITY_ISSUE",
  late_delivery: "LATE_DELIVERY",
  other: "OTHER",
};

/** Customer resolution labels → Prisma RecoveryOption */
const RECOVERY_OPTION_MAP: Record<string, RecoveryOption> = {
  "Exchange Product": "EXCHANGE",
  "Store Credit": "STORE_CREDIT",
  "Partial Refund": "PARTIAL_REFUND",
  "Discount to Keep": "DISCOUNT_TO_KEEP",
  "Full Refund": "FULL_REFUND",
  "Manual Review": "MANUAL_REVIEW",
};

/** Mock AI recommendation labels (stored as String on ReturnItem) */
const AI_RECOMMENDATION_BY_REASON: Record<string, string> = {
  wrong_size: "Exchange Product",
  wrong_color: "Exchange Product",
  damaged_item: "Manual Review",
  wrong_item: "Manual Review",
  changed_mind: "Store Credit",
  quality_issue: "Manual Review",
  late_delivery: "Store Credit",
  other: "Manual Review",
};

export function normalizeOrderNumber(orderNumber: string) {
  return orderNumber.replace("#", "").trim();
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function mapReturnReason(reason: string): ReturnReason {
  return RETURN_REASON_MAP[reason] ?? "OTHER";
}

export function mapRecoveryOption(selectedOption: string): RecoveryOption {
  return RECOVERY_OPTION_MAP[selectedOption] ?? "MANUAL_REVIEW";
}

export function getAiRecommendation(returnReason: string): string {
  return AI_RECOMMENDATION_BY_REASON[returnReason] ?? "Manual Review";
}

export function mapEligibilityStatus(isReturnable: boolean): EligibilityStatus {
  return isReturnable ? "ELIGIBLE" : "NOT_ELIGIBLE";
}
