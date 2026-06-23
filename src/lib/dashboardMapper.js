import { isDisplayableImageSrc, parseProofImage } from "@/lib/proofImageUrl";
import {
  bestActionForReason,
  getPrimaryReasonKey,
  getRequestBestActionFromItems,
  reasonKeyFromUiOrPrisma,
  riskUiForReason,
  scoreForReason,
} from "@/lib/returnScoring";

/** Prisma enums → dashboard UI shape (matches RequestCard + StatusBadge) */

const REASON_TO_UI = {
  WRONG_SIZE: "wrong_size",
  WRONG_COLOR: "wrong_color",
  DAMAGED_ITEM: "damaged_item",
  WRONG_ITEM: "wrong_item",
  CHANGED_MIND: "changed_mind",
  QUALITY_ISSUE: "quality_issue",
  LATE_DELIVERY: "late_delivery",
  OTHER: "other",
};

const RECOVERY_TO_UI = {
  EXCHANGE: "Exchange Product",
  STORE_CREDIT: "Store Credit",
  PARTIAL_REFUND: "Partial Refund",
  DISCOUNT_TO_KEEP: "Discount to Keep",
  FULL_REFUND: "Full Refund",
  MANUAL_REVIEW: "Manual Review",
};

const STATUS_TO_UI = {
  PENDING: "Pending Review",
  IN_REVIEW: "Manual Review",
  APPROVED: "Approved",
  REJECTED: "Needs Attention",
  RESOLVED: "Resolved",
};

const STATUS_FROM_UI = {
  "Pending Review": "PENDING",
  "Manual Review": "IN_REVIEW",
  Approved: "APPROVED",
  "Needs Attention": "REJECTED",
  Resolved: "RESOLVED",
};

const MERCHANT_DECISION_FROM_UI = {
  Approved: "APPROVED",
  "Manual Review": "NEEDS_MORE_INFO",
  Resolved: "APPROVED",
};

function riskUiFromPrisma(riskLevel) {
  if (riskLevel === "LOW") return "Low";
  if (riskLevel === "HIGH") return "High";
  return "Medium";
}

function mapReturnItemToUi(returnItem) {
  const orderItem = returnItem.orderItem;
  const returnReason = REASON_TO_UI[returnItem.reason] ?? "other";
  const reasonKey = reasonKeyFromUiOrPrisma(returnItem.reason);
  const proof = parseProofImage(returnItem.imageUrl);
  const recoveryScore =
    returnItem.recoveryScore ?? scoreForReason(reasonKey);
  const riskLevel = returnItem.riskLevel
    ? riskUiFromPrisma(returnItem.riskLevel)
    : riskUiForReason(reasonKey);
  const recommendedAction =
    returnItem.bestAction ?? bestActionForReason(reasonKey);

  return {
    id: returnItem.id,
    itemId: returnItem.orderItemId,
    title: orderItem?.productName ?? "Unknown product",
    sku: orderItem?.sku ?? "",
    quantity: orderItem?.quantity ?? 1,
    price: orderItem?.price != null ? Number(orderItem.price) : 0,
    returnReason,
    comment: returnItem.comment ?? "",
    selectedOption:
      RECOVERY_TO_UI[returnItem.selectedOption] ?? returnItem.selectedOption,
    proofImageName: proof.fileName || "",
    proofImage: isDisplayableImageSrc(proof.src) ? proof.src : "",
    imageUrl: proof.src || returnItem.imageUrl || "",
    recoveryScore,
    riskLevel,
    bestAction: recommendedAction,
    aiSummary: returnItem.aiSummary ?? "",
    recommendedAction,
  };
}

function mapOrderStatusForDashboard(order) {
  if (!order) {
    return {
      status: null,
      financialStatus: null,
      fulfillmentStatus: null,
      cancelledAt: null,
    };
  }

  return {
    status: order.status ?? null,
    financialStatus: order.financialStatus ?? null,
    fulfillmentStatus: order.fulfillmentStatus ?? null,
    cancelledAt:
      order.cancelledAt?.toISOString?.() ??
      (order.cancelledAt ? String(order.cancelledAt) : null),
  };
}

export function mapReturnRequestToDashboard(returnRequest) {
  const selectedItems = (returnRequest.items ?? []).map(mapReturnItemToUi);
  const primaryReason = getPrimaryReasonKey(
    selectedItems.map((item) => ({ returnReason: item.returnReason }))
  );
  const combinedComment = selectedItems
    .map((item) => item.comment)
    .filter(Boolean)
    .join(" | ");

  const merchantNotes = (returnRequest.items ?? [])
    .map((item) => item.merchantNote)
    .filter(Boolean);
  const merchantDecisions = (returnRequest.items ?? [])
    .map((item) => item.merchantDecision)
    .filter((d) => d && d !== "PENDING");

  const primaryItem =
    selectedItems.find((item) => item.returnReason === primaryReason) ??
    selectedItems[0];

  const recoveryScore =
    primaryItem?.recoveryScore ?? scoreForReason(primaryReason);
  const riskLevel =
    primaryItem?.riskLevel ?? riskUiForReason(primaryReason);

  return {
    id: returnRequest.id,
    orderNumber: returnRequest.order?.orderNumber ?? "",
    email: returnRequest.customerEmail,
    orderStatus: mapOrderStatusForDashboard(returnRequest.order),
    rawStatus: returnRequest.status,
    status: STATUS_TO_UI[returnRequest.status] ?? returnRequest.status,
    reason: primaryReason,
    comment: combinedComment,
    customerComment: combinedComment,
    selectedOption: selectedItems[0]?.selectedOption ?? "",
    proofImage:
      selectedItems.find((item) => isDisplayableImageSrc(item.proofImage))
        ?.proofImage ?? "",
    orderItems: (returnRequest.order?.items ?? []).map((oi) => ({
      id: oi.id,
      productName: oi.productName,
      sku: oi.sku,
      quantity: oi.quantity,
      price: oi.price != null ? Number(oi.price) : 0,
      isReturnable: oi.isReturnable,
    })),
    recoveryScore,
    riskLevel,
    bestAction: getRequestBestActionFromItems(selectedItems),
    selectedItems,
    returnRequestItems: selectedItems,
    merchantNote: merchantNotes[0] ?? "",
    merchantDecision:
      merchantDecisions[0] === "APPROVED"
        ? "Approved"
        : merchantDecisions[0] === "NEEDS_MORE_INFO"
          ? "Manual Review"
          : merchantDecisions[0] === "REJECTED"
            ? "Rejected"
            : returnRequest.status === "RESOLVED"
              ? "Resolved"
              : "",
    eligibilityStatus: returnRequest.eligibilityStatus,
    createdAt:
      returnRequest.createdAt?.toISOString?.() ?? returnRequest.createdAt,
    updatedAt:
      returnRequest.updatedAt?.toISOString?.() ?? returnRequest.updatedAt,
  };
}

export function mapUiStatusToPrisma(status) {
  return STATUS_FROM_UI[status] ?? undefined;
}

export function mapUiMerchantDecisionToPrisma(merchantDecision) {
  return MERCHANT_DECISION_FROM_UI[merchantDecision] ?? undefined;
}
