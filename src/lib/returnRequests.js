export const STORAGE_KEY = "returnRequests";

// Empty array kept for API routes that still import this module on the server
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

const actionMap = {
  wrong_size: "Exchange Product",
  damaged_item: "Manual Review",
  changed_mind: "Store Credit",
  late_delivery: "Partial Refund",
  other: "Manual Review",
};

export function buildReturnRequest({
  orderNumber,
  email,
  reason,
  comment,
  selectedOption,
  proofImage,
}) {
  return {
    id: Date.now(),
    orderNumber: orderNumber.replace("#", "").trim(),
    email,
    reason,
    customerComment: comment || "",
    selectedOption,
    recoveryScore: scoreMap[reason] ?? 60,
    riskLevel: riskMap[reason] ?? "Medium",
    bestAction: actionMap[reason] ?? "Manual Review",
    status: "Pending Review",
    createdAt: new Date().toISOString(),
    proofImage: proofImage || "",
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
