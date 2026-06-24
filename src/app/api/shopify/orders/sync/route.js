import { NextResponse } from "next/server";
import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
  getAuditRequestContext,
  logUnauthorizedApiAccess,
  safeCreateAdminAuditLog,
} from "@/lib/adminAudit";
import {
  AUDIT_ACTORS,
  AUDIT_EVENTS,
  logAuditInfo,
  sanitizeAuditMetadata,
} from "@/lib/audit";
import {
  AppError,
  createApiErrorResponse,
  handleApiError,
  logSafeError,
} from "@/lib/errors";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { captureException } from "@/lib/sentry";
import {
  getMerchantSyncAuditContext,
} from "@/lib/syncShopifyOrders";
import { queueShopifySyncForMerchant } from "@/lib/shopifySyncQueue";

function isProtectedCustomerDataError(error) {
  return (
    error?.code === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED" ||
    error?.message === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"
  );
}

function isShopifyNetworkError(error) {
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

function logShopifySyncError(context, error, syncContext, meta = {}) {
  console.error("[Shopify Sync]", {
    context,
    merchantId: syncContext?.merchantId ?? null,
    shopDomain: syncContext?.shopDomain ?? null,
    endpoint: error?.endpoint ?? meta.endpoint ?? null,
    httpStatus: error?.status ?? null,
    code: error?.code ?? null,
    hasToken: syncContext?.hasToken ?? false,
  });

  logSafeError(context, error);
}

function buildSyncAuditMeta(syncContext, extra = {}) {
  return sanitizeAuditMetadata({
    merchantId: syncContext?.merchantId ?? null,
    shopDomain: syncContext?.shopDomain ?? null,
    hasToken: syncContext?.hasToken ?? false,
    ...extra,
  });
}

function resolveSyncFailureAudit(error) {
  if (isProtectedCustomerDataError(error)) {
    return {
      code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      httpStatus: 403,
    };
  }

  if (error instanceof AppError) {
    return { code: error.code, httpStatus: error.status };
  }

  const httpStatus = error?.status;

  if (httpStatus === 401 || httpStatus === 403) {
    return { code: "SHOPIFY_PERMISSION_REQUIRED", httpStatus };
  }

  if (httpStatus === 429) {
    return { code: "SHOPIFY_RATE_LIMIT", httpStatus: 429 };
  }

  if (httpStatus === 500 || httpStatus === 502 || httpStatus === 503) {
    return { code: "SHOPIFY_UNAVAILABLE", httpStatus: 502 };
  }

  if (isShopifyNetworkError(error)) {
    return { code: "SHOPIFY_CONNECTION_ERROR", httpStatus: 503 };
  }

  return {
    code: error?.code ?? "SHOPIFY_SYNC_ERROR",
    httpStatus: httpStatus ?? 500,
  };
}

async function handleShopifySyncRouteError(error, meta = {}) {
  console.log("=== SHOPIFY SYNC FULL ERROR ===");
  console.dir(error, { depth: null });
  console.log("==============================");

  const { syncContext, request } = meta;
  const requestContext = request
    ? getAuditRequestContext(request)
    : { ipAddress: null, userAgent: null };

  if (isProtectedCustomerDataError(error)) {
    console.error("[Shopify Sync]", {
      context: "shopify-order-sync",
      merchantId: syncContext?.merchantId ?? null,
      shopDomain: syncContext?.shopDomain ?? null,
      endpoint: error?.endpoint ?? null,
      httpStatus: 403,
      code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      hasToken: syncContext?.hasToken ?? false,
    });

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED,
      buildSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.SHOPIFY,
        endpoint: error?.endpoint ?? null,
        httpStatus: 403,
        code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      })
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext?.merchantId ?? null,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED,
      actorType: ADMIN_AUDIT_ACTORS.SHOPIFY,
      severity: ADMIN_AUDIT_SEVERITY.WARN,
      resourceType: "SHOPIFY_SYNC",
      message: "Shopify protected customer data access required",
      metadata: {
        shopDomain: syncContext?.shopDomain ?? null,
        endpoint: error?.endpoint ?? null,
        httpStatus: 403,
        code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
        hasToken: syncContext?.hasToken ?? false,
      },
      ...requestContext,
    });

    return createApiErrorResponse(
      "Shopify connection works, but order sync requires protected customer data access approval in Shopify Partner Dashboard.",
      403,
      "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      {
        nextStep:
          "Go to Shopify Partner Dashboard > App > API access > Protected customer data access, request access, make sure read_orders is included, then reinstall the app.",
      }
    );
  }

  const { code, httpStatus } = resolveSyncFailureAudit(error);

  logShopifySyncError("shopify-order-sync", error, syncContext, meta);

  logAuditInfo(
    AUDIT_EVENTS.SHOPIFY_SYNC_FAILED,
    buildSyncAuditMeta(syncContext, {
      actorType: AUDIT_ACTORS.SYSTEM,
      code,
      httpStatus,
    })
  );

  await safeCreateAdminAuditLog({
    merchantId: syncContext?.merchantId ?? null,
    eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_FAILED,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: ADMIN_AUDIT_SEVERITY.ERROR,
    resourceType: "SHOPIFY_SYNC",
    message: "Shopify order sync failed",
    metadata: {
      shopDomain: syncContext?.shopDomain ?? null,
      code,
      httpStatus,
    },
    ...requestContext,
  });

  if (error instanceof AppError) {
    return createApiErrorResponse(error.message, error.status, error.code);
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return createApiErrorResponse(
      "Shopify permission required",
      httpStatus,
      "SHOPIFY_PERMISSION_REQUIRED"
    );
  }

  if (httpStatus === 429) {
    return createApiErrorResponse(
      "Shopify rate limit reached. Please try again later.",
      429,
      "SHOPIFY_RATE_LIMIT"
    );
  }

  if (code === "SHOPIFY_UNAVAILABLE") {
    return createApiErrorResponse(
      "Shopify is temporarily unavailable. Please try again later.",
      502,
      "SHOPIFY_UNAVAILABLE"
    );
  }

  if (code === "SHOPIFY_CONNECTION_ERROR") {
    return createApiErrorResponse(
      "Unable to connect to Shopify. Please try again.",
      503,
      "SHOPIFY_CONNECTION_ERROR"
    );
  }

  return handleApiError(error, {
    context: "shopify-order-sync",
    fallbackMessage: "Unable to sync Shopify orders. Please try again.",
    fallbackCode: "SHOPIFY_SYNC_ERROR",
  });
}

/**
 * Sync Shopify orders for the authenticated merchant only.
 * Request body is intentionally ignored — never pass merchantId from the client.
 */
export async function POST(request) {
  let merchant = null;
  let syncContext = null;

  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: "shopify-order-sync",
      limit: 5,
      windowMs: 5 * 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      await safeCreateAdminAuditLog({
        eventType: ADMIN_AUDIT_EVENTS.RATE_LIMIT_TRIGGERED,
        actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
        severity: ADMIN_AUDIT_SEVERITY.WARN,
        resourceType: "SHOPIFY_SYNC",
        message: "Shopify sync rate limit triggered",
        metadata: { routeName: "shopify-order-sync" },
        ...getAuditRequestContext(request),
      });

      return rateLimitResponse(rateLimitResult);
    }

    const auth = await requireMerchantForRoute();
    if (auth.response) {
      await logUnauthorizedApiAccess(request, {
        routeName: "shopify-order-sync",
        resourceId: "/api/shopify/orders/sync",
        method: "POST",
      });

      return createApiErrorResponse("Unauthorized", 401, "UNAUTHORIZED");
    }

    merchant = auth.merchant;
    syncContext = await getMerchantSyncAuditContext(merchant.id);

    const requestContext = getAuditRequestContext(request);

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_SYNC_STARTED,
      buildSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.SYSTEM,
      })
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext.merchantId,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_STARTED,
      actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      resourceType: "SHOPIFY_SYNC",
      message: "Shopify order sync queued",
      metadata: {
        shopDomain: syncContext.shopDomain,
        hasToken: syncContext.hasToken,
      },
      ...requestContext,
    });

    if (!syncContext.hasToken || !syncContext.shopDomain) {
      return createApiErrorResponse(
        "Missing Shopify connection",
        400,
        "MISSING_SHOPIFY_CONNECTION"
      );
    }

    const queueResult = await queueShopifySyncForMerchant({
      merchantId: merchant.id,
      reason: "manual:dashboard-orders",
    });

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_SYNC_COMPLETED,
      buildSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.SYSTEM,
        queued: true,
        requestedAt: queueResult.requestedAt,
      })
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext.merchantId,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_COMPLETED,
      actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      resourceType: "SHOPIFY_SYNC",
      message: "Shopify order sync queued",
      metadata: {
        shopDomain: syncContext.shopDomain,
        queued: true,
        requestedAt: queueResult.requestedAt,
      },
      ...requestContext,
    });

    return NextResponse.json({
      success: true,
      queued: true,
      message: "Shopify sync queued",
      requestedAt: queueResult.requestedAt,
    });
  } catch (error) {
    if (!syncContext && merchant?.id) {
      syncContext = await getMerchantSyncAuditContext(merchant.id);
    }

    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id || syncContext?.merchantId || null,
      shopDomain: merchant?.shopDomain || syncContext?.shopDomain || null,
      action: "shopify_sync",
    });

    return handleShopifySyncRouteError(error, { syncContext, request });
  }
}
