const DEFAULT_TIMEOUT_MS = 30_000;

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * JSON fetch helper for merchant dashboard pages.
 * Uses same-origin credentials, no-store cache, and a request timeout.
 *
 * @param {string} url
 * @param {{
 *   method?: string;
 *   body?: unknown;
 *   signal?: AbortSignal;
 *   timeoutMs?: number;
 * }} [options]
 */
export async function fetchMerchantJson(url, options = {}) {
  const {
    method = "GET",
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const abortFromParent = () => timeoutController.abort();
  if (signal) {
    if (signal.aborted) {
      timeoutController.abort();
    } else {
      signal.addEventListener("abort", abortFromParent);
    }
  }

  try {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: timeoutController.signal,
    });

    const data = await parseJsonSafely(res);
    return { res, data, aborted: false };
  } catch (error) {
    if (error?.name === "AbortError") {
      return { res: null, data: {}, aborted: true };
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", abortFromParent);
    }
  }
}

/**
 * @param {unknown} data
 * @param {string} arrayKey
 */
export function readArrayField(data, arrayKey) {
  if (!data || typeof data !== "object") {
    return [];
  }

  const value = data[arrayKey];
  return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} data
 * @param {string} objectKey
 */
export function readObjectField(data, objectKey) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const value = data[objectKey];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

/**
 * @param {Response | null} res
 * @param {unknown} data
 * @param {string} fallbackMessage
 */
export function getApiErrorMessage(res, data, fallbackMessage) {
  if (data && typeof data === "object") {
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }

    if (typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }

    if (Array.isArray(data.details)) {
      const detailMessage = data.details
        .map((item) =>
          item && typeof item.message === "string" ? item.message : "",
        )
        .filter(Boolean)
        .join(" ");

      if (detailMessage) {
        return detailMessage;
      }
    }
  }

  if (res?.status === 401) {
    return "Please sign in to continue.";
  }

  return fallbackMessage;
}

/**
 * Normalize a single dashboard request record for safe client rendering.
 * @param {unknown} request
 */
export function normalizeDashboardRequest(request) {
  if (!request || typeof request !== "object") {
    return null;
  }

  const record = /** @type {Record<string, unknown>} */ (request);
  const selectedItems = Array.isArray(record.selectedItems)
    ? record.selectedItems
    : Array.isArray(record.returnRequestItems)
      ? record.returnRequestItems
      : [];
  const recoveryScore = Number(record.recoveryScore);

  return {
    ...record,
    id: record.id ?? "",
    email:
      typeof record.email === "string"
        ? record.email
        : typeof record.customerEmail === "string"
          ? record.customerEmail
          : "",
    orderNumber:
      typeof record.orderNumber === "string" ? record.orderNumber : "",
    status:
      typeof record.status === "string" ? record.status : "Pending Review",
    rawStatus: typeof record.rawStatus === "string" ? record.rawStatus : null,
    riskLevel:
      typeof record.riskLevel === "string" ? record.riskLevel : "Medium",
    recoveryScore: Number.isFinite(recoveryScore) ? recoveryScore : 0,
    bestAction:
      typeof record.bestAction === "string"
        ? record.bestAction
        : "Manual Review",
    reason: typeof record.reason === "string" ? record.reason : "other",
    comment: typeof record.comment === "string" ? record.comment : "",
    customerComment:
      typeof record.customerComment === "string"
        ? record.customerComment
        : typeof record.comment === "string"
          ? record.comment
          : "",
    merchantNote:
      typeof record.merchantNote === "string" ? record.merchantNote : "",
    merchantDecision:
      typeof record.merchantDecision === "string"
        ? record.merchantDecision
        : "",
    selectedOption:
      typeof record.selectedOption === "string" ? record.selectedOption : "",
    proofImage: typeof record.proofImage === "string" ? record.proofImage : "",
    createdAt: record.createdAt ?? null,
    updatedAt: record.updatedAt ?? null,
    orderStatus:
      record.orderStatus && typeof record.orderStatus === "object"
        ? record.orderStatus
        : {
            status: null,
            financialStatus: null,
            fulfillmentStatus: null,
            cancelledAt: null,
          },
    selectedItems,
    returnRequestItems: Array.isArray(record.returnRequestItems)
      ? record.returnRequestItems
      : selectedItems,
    orderItems: Array.isArray(record.orderItems) ? record.orderItems : [],
  };
}

/**
 * Extract dashboard requests from common API response shapes.
 * Primary shape: { success: true, requests: [...] }
 *
 * @param {unknown} data
 */
export function normalizeDashboardRequestsResponse(data) {
  if (!data || typeof data !== "object") {
    return [];
  }

  const payload = /** @type {Record<string, unknown>} */ (data);
  const nestedData =
    payload.data &&
    typeof payload.data === "object" &&
    !Array.isArray(payload.data)
      ? /** @type {Record<string, unknown>} */ (payload.data)
      : null;

  const candidates = [
    payload.requests,
    payload.returnRequests,
    nestedData?.requests,
    nestedData?.returnRequests,
    payload.items,
    Array.isArray(payload.data) ? payload.data : null,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((request) => normalizeDashboardRequest(request))
        .filter(Boolean);
    }
  }

  return [];
}

/**
 * @param {Response | null} res
 * @param {unknown} data
 */
export function isDashboardApiSuccess(res, data) {
  if (!res?.ok) {
    return false;
  }

  if (!data || typeof data !== "object") {
    return false;
  }

  return /** @type {{ success?: unknown }} */ (data).success === true;
}

/**
 * Pure handler for dashboard return-request load responses.
 * Used by dashboard pages and unit tests.
 *
 * @param {{
 *   res: Response | null;
 *   data: unknown;
 *   aborted?: boolean;
 *   background?: boolean;
 *   fallbackMessage?: string;
 * }} input
 */
export function processDashboardRequestsLoadResult({
  res,
  data,
  aborted = false,
  background = false,
  fallbackMessage = "Could not load return requests.",
}) {
  if (aborted) {
    return {
      ok: false,
      requests: null,
      error: background ? null : fallbackMessage,
      shouldClearRequests: !background,
    };
  }

  if (!isDashboardApiSuccess(res, data)) {
    return {
      ok: false,
      requests: null,
      error: background ? null : getApiErrorMessage(res, data, fallbackMessage),
      shouldClearRequests: !background,
    };
  }

  return {
    ok: true,
    requests: normalizeDashboardRequestsResponse(data),
    error: null,
    shouldClearRequests: false,
  };
}

/** Hide spinner once requests are available even if loading flag is stale. */
export function shouldShowDashboardLoadingSpinner(loading, requestCount) {
  return loading === true && requestCount === 0;
}
