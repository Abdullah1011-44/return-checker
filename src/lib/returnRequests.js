export const STORAGE_KEY = "returnRequests";

export const returnRequests = [];

const scoreMap = {
  wrong_size: 92,
  damaged_item: 55,
  changed_mind: 70,
  late_delivery: 74,
  other: 60,
};

const riskMap = {
  wrong_size: "Low",
  damaged_item: "High",
  changed_mind: "Low",
  late_delivery: "Medium",
  other: "Medium",
};

const itemActionMap = {
  wrong_size: "Exchange Product",
  changed_mind: "Store Credit",
  damaged_item: "Manual Review",
  defective_item: "Manual Review",
  late_delivery: "Store Credit",
  other: "Manual Review",
};

export function getItemRecommendedAction(returnReason) {
  return itemActionMap[returnReason] ?? "Manual Review";
}

function getRequestBestAction(items) {
  const recommendations = items.map((item) =>
    getItemRecommendedAction(item.returnReason),
  );
  const unique = [...new Set(recommendations.filter(Boolean))];

  if (unique.length === 0) return "Manual Review";
  if (unique.length === 1) return unique[0];
  return "Mixed Recommendations";
}

function getPrimaryReason(items) {
  if (!items.length) return "other";
  const scores = items.map((item) => scoreMap[item.returnReason] ?? 60);
  const lowestScore = Math.min(...scores);
  const primary = items.find(
    (item) => (scoreMap[item.returnReason] ?? 60) === lowestScore,
  );
  return primary?.returnReason || items[0].returnReason || "other";
}

function normalizeReturnRequestItem(item) {
  const returnReason = item.returnReason || "";
  return {
    itemId: item.itemId || item.id,
    id: item.itemId || item.id,
    title: item.title,
    sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    returnReason,
    comment: item.comment || "",
    selectedOption: item.selectedOption || "",
    proofImageName: item.proofImageName || "",
    proofImage: item.proofImage || "",
    recommendedAction:
      item.recommendedAction || getItemRecommendedAction(returnReason),
  };
}

function mapToSelectedItems(returnRequestItems) {
  return returnRequestItems.map((item) => {
    const normalized = normalizeReturnRequestItem(item);
    return {
      id: normalized.itemId,
      title: normalized.title,
      sku: normalized.sku,
      quantity: normalized.quantity,
      price: normalized.price,
      returnReason: normalized.returnReason,
      comment: normalized.comment,
      selectedOption: normalized.selectedOption,
      proofImageName: normalized.proofImageName,
      proofImage: normalized.proofImage,
      recommendedAction: normalized.recommendedAction,
    };
  });
}

export function buildReturnRequest({
  orderNumber,
  email,
  returnRequestItems = [],
}) {
  const normalizedItems = returnRequestItems.map(normalizeReturnRequestItem);
  const selectedItems = mapToSelectedItems(normalizedItems);
  const primaryReason = getPrimaryReason(normalizedItems);
  const combinedComment = normalizedItems
    .map((item) => item.comment)
    .filter(Boolean)
    .join(" | ");

  return {
    id: Date.now(),
    orderNumber: orderNumber.replace("#", "").trim(),
    email,
    returnRequestItems: normalizedItems,
    selectedItems,
    reason: primaryReason,
    comment: combinedComment,
    selectedOption: selectedItems[0]?.selectedOption || "",
    customerComment: combinedComment,
    proofImage: selectedItems.find((item) => item.proofImage)?.proofImage || "",
    recoveryScore: scoreMap[primaryReason] ?? 60,
    riskLevel: riskMap[primaryReason] ?? "Medium",
    bestAction: getRequestBestAction(normalizedItems),
    status: "Pending Review",
    createdAt: new Date().toISOString(),
  };
}

export function getReturnRequests() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReturnRequests(requests) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
}

export function addReturnRequest(request) {
  const requests = getReturnRequests();
  requests.push(request);
  saveReturnRequests(requests);
  return request;
}

export function updateReturnRequestInStorage(updated) {
  const requests = getReturnRequests();
  const next = requests.map((r) => (r.id === updated.id ? updated : r));
  saveReturnRequests(next);
  return updated;
}
