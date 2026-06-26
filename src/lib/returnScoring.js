/** Mock AI recovery scoring — shared by submit API and dashboard mapper */

export const scoreMap = {
  wrong_size: 92,
  wrong_color: 70,
  damaged_item: 55,
  wrong_item: 55,
  changed_mind: 70,
  quality_issue: 55,
  late_delivery: 74,
  other: 60,
};

export const riskUiMap = {
  wrong_size: "Low",
  wrong_color: "Medium",
  damaged_item: "High",
  wrong_item: "High",
  changed_mind: "Low",
  quality_issue: "High",
  late_delivery: "Medium",
  other: "Medium",
};

export const itemActionMap = {
  wrong_size: "Exchange Product",
  wrong_color: "Exchange Product",
  damaged_item: "Manual Review",
  wrong_item: "Manual Review",
  changed_mind: "Store Credit",
  quality_issue: "Manual Review",
  late_delivery: "Store Credit",
  other: "Manual Review",
};

const UI_REASON_TO_KEY = {
  WRONG_SIZE: "wrong_size",
  WRONG_COLOR: "wrong_color",
  DAMAGED_ITEM: "damaged_item",
  WRONG_ITEM: "wrong_item",
  CHANGED_MIND: "changed_mind",
  QUALITY_ISSUE: "quality_issue",
  LATE_DELIVERY: "late_delivery",
  OTHER: "other",
};

export function reasonKeyFromUiOrPrisma(reason) {
  if (!reason) return "other";
  if (UI_REASON_TO_KEY[reason]) return UI_REASON_TO_KEY[reason];
  if (scoreMap[reason] !== undefined) return reason;
  return "other";
}

export function scoreForReason(reasonKey) {
  return scoreMap[reasonKey] ?? 60;
}

export function riskUiForReason(reasonKey) {
  return riskUiMap[reasonKey] ?? "Medium";
}

export function riskPrismaForReason(reasonKey) {
  const ui = riskUiForReason(reasonKey);
  if (ui === "Low") return "LOW";
  if (ui === "High") return "HIGH";
  return "MEDIUM";
}

export function bestActionForReason(reasonKey) {
  return itemActionMap[reasonKey] ?? "Manual Review";
}

export function buildAiSummary({ reasonKey, selectedOptionLabel, bestAction }) {
  const reasonLabel = reasonKey.replace(/_/g, " ");
  return `Customer reported ${reasonLabel}. Preferred resolution: ${selectedOptionLabel || "not specified"}. Recommended action: ${bestAction}.`;
}

export function getPrimaryReasonKey(items) {
  if (!items.length) return "other";
  const scores = items.map((item) => {
    const key = reasonKeyFromUiOrPrisma(item.returnReason ?? item.reason);
    return scoreForReason(key);
  });
  const lowestScore = Math.min(...scores);
  const primary = items.find((item) => {
    const key = reasonKeyFromUiOrPrisma(item.returnReason ?? item.reason);
    return scoreForReason(key) === lowestScore;
  });
  return reasonKeyFromUiOrPrisma(
    primary?.returnReason ??
      primary?.reason ??
      items[0].returnReason ??
      items[0].reason,
  );
}

export function getRequestBestActionFromItems(items) {
  const actions = items.map((item) => {
    const key = reasonKeyFromUiOrPrisma(item.returnReason ?? item.reason);
    return (
      item.bestAction || item.recommendedAction || bestActionForReason(key)
    );
  });
  const unique = [...new Set(actions.filter(Boolean))];
  if (unique.length === 0) return "Manual Review";
  if (unique.length === 1) return unique[0];
  return "Mixed Recommendations";
}

export function resolveRequestEligibility(orderItems) {
  const returnable = orderItems.filter((oi) => oi.isReturnable);
  if (returnable.length === orderItems.length)
    return { status: "ELIGIBLE", reason: null };
  if (returnable.length === 0) {
    return {
      status: "NOT_ELIGIBLE",
      reason: "No selected items are returnable.",
    };
  }
  return {
    status: "NEEDS_REVIEW",
    reason: "Some selected items may not be eligible for return.",
  };
}
