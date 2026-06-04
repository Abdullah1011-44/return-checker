/** Prisma → customer-facing return status (status tracking page) */

const STATUS_TO_CUSTOMER = {
  PENDING: "Pending Review",
  IN_REVIEW: "Needs More Info",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RESOLVED: "Resolved",
};

const DECISION_TO_CUSTOMER = {
  PENDING: "Awaiting review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_MORE_INFO: "Needs More Info",
};

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

const REASON_LABELS = {
  wrong_size: "Wrong size",
  wrong_color: "Wrong color",
  damaged_item: "Damaged item",
  wrong_item: "Wrong item",
  changed_mind: "Changed mind",
  quality_issue: "Quality issue",
  late_delivery: "Late delivery",
  other: "Other",
};

const RECOVERY_TO_UI = {
  EXCHANGE: "Exchange Product",
  STORE_CREDIT: "Store Credit",
  PARTIAL_REFUND: "Partial Refund",
  DISCOUNT_TO_KEEP: "Discount to Keep",
  FULL_REFUND: "Full Refund",
  MANUAL_REVIEW: "Manual Review",
};

function formatReason(prismaReason) {
  const key = REASON_TO_UI[prismaReason] ?? "other";
  return REASON_LABELS[key] ?? "Other";
}

function resolveMerchantDecision(items) {
  const decisions = [
    ...new Set(
      (items ?? [])
        .map((item) => item.merchantDecision)
        .filter((d) => d && d !== "PENDING")
    ),
  ];

  if (decisions.length === 0) return DECISION_TO_CUSTOMER.PENDING;
  if (decisions.length === 1) {
    return DECISION_TO_CUSTOMER[decisions[0]] ?? DECISION_TO_CUSTOMER.PENDING;
  }
  return "Multiple updates";
}

function combineMerchantNotes(items) {
  const notes = (items ?? [])
    .map((item) => item.merchantNote?.trim())
    .filter(Boolean);
  if (notes.length === 0) return "";
  return [...new Set(notes)].join("\n\n");
}

export function mapReturnRequestToCustomerStatus(returnRequest) {
  const items = (returnRequest.items ?? []).map((returnItem) => {
    const orderItem = returnItem.orderItem;
    return {
      id: returnItem.id,
      productName: orderItem?.productName ?? "Item",
      sku: orderItem?.sku ?? "",
      quantity: orderItem?.quantity ?? 1,
      returnReason: formatReason(returnItem.reason),
      selectedOption:
        RECOVERY_TO_UI[returnItem.selectedOption] ?? returnItem.selectedOption,
      merchantDecision:
        DECISION_TO_CUSTOMER[returnItem.merchantDecision] ??
        DECISION_TO_CUSTOMER.PENDING,
    };
  });

  const submittedAt =
    returnRequest.submittedAt?.toISOString?.() ?? returnRequest.submittedAt;
  const updatedAt =
    returnRequest.updatedAt?.toISOString?.() ?? returnRequest.updatedAt;

  return {
    id: returnRequest.id,
    orderNumber: returnRequest.order?.orderNumber ?? "",
    email: returnRequest.customerEmail,
    status:
      STATUS_TO_CUSTOMER[returnRequest.status] ?? returnRequest.status,
    submittedAt,
    updatedAt,
    merchantNote: combineMerchantNotes(returnRequest.items),
    merchantDecision: resolveMerchantDecision(returnRequest.items),
    items,
  };
}
