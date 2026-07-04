import { AppError } from "@/lib/errors";

const IS_DEV = process.env.NODE_ENV === "development";

const SHOPIFY_SYNC_HTTP_STATUS_BY_CODE = {
  SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED: 403,
  SHOPIFY_TOKEN_INVALID: 401,
  SHOPIFY_ORDER_ACCESS_DENIED: 403,
  SHOPIFY_ENDPOINT_NOT_FOUND: 404,
  SHOPIFY_RATE_LIMITED: 429,
  SHOPIFY_NETWORK_ERROR: 503,
  SHOPIFY_API_ERROR: 502,
  SHOPIFY_UNAVAILABLE: 502,
  INNGEST_QUEUE_UNAVAILABLE: 503,
  INNGEST_QUEUE_ERROR: 503,
};

export function isInngestQueueError(error) {
  if (
    error?.code === "INNGEST_QUEUE_UNAVAILABLE" ||
    error?.code === "INNGEST_QUEUE_ERROR"
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (
    message.includes("localhost:8288") ||
    message.includes("127.0.0.1:8288") ||
    message.includes("::1:8288")
  ) {
    return true;
  }

  const cause = error?.cause;
  if (cause && typeof cause === "object") {
    if ("port" in cause && cause.port === 8288) {
      return true;
    }

    if ("code" in cause && cause.code === "ECONNREFUSED") {
      const nestedMessage =
        cause instanceof Error ? cause.message : String(cause.message ?? "");
      if (
        nestedMessage.includes("8288") ||
        ("port" in cause && cause.port === 8288)
      ) {
        return true;
      }
    }
  }

  return false;
}

export function isProtectedCustomerDataError(error) {
  return (
    error?.code === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED" ||
    error?.message === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"
  );
}

export function isShopifyNetworkError(error) {
  if (isInngestQueueError(error)) {
    return false;
  }

  if (error?.code === "SHOPIFY_NETWORK_ERROR") {
    return true;
  }

  const cause = error?.cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const networkCodes = [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "ECONNRESET",
      "UND_ERR_CONNECT_TIMEOUT",
    ];
    if (networkCodes.includes(cause.code)) {
      return true;
    }
  }

  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

/**
 * @param {unknown} error
 */
export function resolveSyncFailureAudit(error) {
  if (isProtectedCustomerDataError(error)) {
    return {
      code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      httpStatus: 403,
    };
  }

  if (typeof error?.code === "string") {
    if (error.code === "SHOPIFY_RATE_LIMIT") {
      return { code: "SHOPIFY_RATE_LIMITED", httpStatus: 429 };
    }

    if (SHOPIFY_SYNC_HTTP_STATUS_BY_CODE[error.code]) {
      return {
        code: error.code,
        httpStatus: SHOPIFY_SYNC_HTTP_STATUS_BY_CODE[error.code],
      };
    }
  }

  if (error instanceof AppError) {
    return { code: error.code, httpStatus: error.status };
  }

  const httpStatus = error?.status;

  if (httpStatus === 401) {
    return { code: "SHOPIFY_TOKEN_INVALID", httpStatus: 401 };
  }

  if (httpStatus === 403) {
    return { code: "SHOPIFY_ORDER_ACCESS_DENIED", httpStatus: 403 };
  }

  if (httpStatus === 404) {
    return { code: "SHOPIFY_ENDPOINT_NOT_FOUND", httpStatus: 404 };
  }

  if (httpStatus === 429) {
    return { code: "SHOPIFY_RATE_LIMITED", httpStatus: 429 };
  }

  if (httpStatus === 500 || httpStatus === 502 || httpStatus === 503) {
    return { code: "SHOPIFY_UNAVAILABLE", httpStatus: 502 };
  }

  if (isShopifyNetworkError(error)) {
    return { code: "SHOPIFY_NETWORK_ERROR", httpStatus: 503 };
  }

  return {
    code: error?.code ?? "SHOPIFY_SYNC_ERROR",
    httpStatus: httpStatus ?? 500,
  };
}

/**
 * @param {unknown} error
 * @param {{ shopDomain?: string | null, hasToken?: boolean }} [syncContext]
 */
export function buildShopifySyncSafeLogMeta(error, syncContext = {}) {
  return {
    shopDomain: syncContext.shopDomain ?? error?.shopDomain ?? null,
    endpoint: error?.endpoint ?? null,
    apiType: error?.apiType ?? null,
    apiVersion: error?.apiVersion ?? null,
    httpStatus: error?.status ?? null,
    code: error?.code ?? null,
    errorSummary: error?.errorSummary ?? null,
    hasToken: syncContext.hasToken ?? false,
  };
}

/**
 * @param {string} context
 * @param {unknown} error
 * @param {{ shopDomain?: string | null, hasToken?: boolean }} [syncContext]
 */
export function logShopifySyncError(context, error, syncContext = {}) {
  const safeMeta = buildShopifySyncSafeLogMeta(error, syncContext);

  console.error(`[Shopify Sync:${context}]`, safeMeta);

  if (IS_DEV) {
    console.debug(`[Shopify Sync:${context}:debug]`, safeMeta);
  }
}

/**
 * @param {unknown} error
 */
export function buildShopifySyncErrorMessage(error) {
  const code = error?.code;

  if (code === "SHOPIFY_TOKEN_INVALID") {
    return "Shopify access token is invalid. Reconnect the app from Shopify Admin.";
  }

  if (code === "SHOPIFY_ORDER_ACCESS_DENIED") {
    return "Shopify denied order access. Confirm read_orders scope and Protected Customer Data approval, then reinstall the app.";
  }

  if (code === "SHOPIFY_ENDPOINT_NOT_FOUND") {
    const endpoint = error?.endpoint ?? "/orders.json";
    const apiVersion = error?.apiVersion ?? "unknown";
    return `Shopify Admin API endpoint not found (REST ${apiVersion}${endpoint}).`;
  }

  if (code === "SHOPIFY_RATE_LIMITED" || code === "SHOPIFY_RATE_LIMIT") {
    return "Shopify rate limit reached. Please try again later.";
  }

  if (code === "SHOPIFY_NETWORK_ERROR") {
    return "Unable to connect to Shopify. Check network connectivity and try again.";
  }

  if (code === "INNGEST_QUEUE_UNAVAILABLE") {
    return "Background sync queue is unavailable. Dashboard sync runs directly against Shopify; start the Inngest dev server only for scheduled jobs.";
  }

  if (code === "INNGEST_QUEUE_ERROR") {
    return "Unable to queue Shopify sync job. Try again or run dashboard sync directly.";
  }

  if (code === "SHOPIFY_UNAVAILABLE") {
    return "Shopify is temporarily unavailable. Please try again later.";
  }

  if (code === "SHOPIFY_API_ERROR") {
    return "Shopify Admin API request failed.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to sync Shopify orders. Please try again.";
}

/**
 * @param {unknown} error
 * @param {{ shopDomain?: string | null }} [syncContext]
 */
export function buildShopifySyncErrorDetails(error, syncContext = {}) {
  const shopDomain = syncContext.shopDomain ?? error?.shopDomain ?? null;

  if (error?.code === "SHOPIFY_ENDPOINT_NOT_FOUND") {
    return {
      endpoint: error?.endpoint ?? null,
      apiType: error?.apiType ?? "REST",
      apiVersion: error?.apiVersion ?? null,
    };
  }

  if (error?.code === "SHOPIFY_TOKEN_INVALID") {
    return {
      nextStep:
        "Reconnect the app from Shopify Admin to refresh the access token.",
      reconnectPath: shopDomain
        ? `/api/auth/install?shop=${encodeURIComponent(shopDomain)}`
        : null,
    };
  }

  if (error?.code === "SHOPIFY_ORDER_ACCESS_DENIED") {
    return {
      nextStep:
        "Confirm read_orders is granted and Protected Customer Data access is approved, then reinstall the app.",
    };
  }

  return undefined;
}
