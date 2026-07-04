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
import { createApiErrorResponse, handleApiError } from "@/lib/errors";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { captureException } from "@/lib/sentry";
import {
  buildShopifySyncErrorDetails,
  buildShopifySyncErrorMessage,
  buildShopifySyncSafeLogMeta,
  isProtectedCustomerDataError,
  logShopifySyncError,
  resolveSyncFailureAudit,
} from "@/lib/shopifySyncErrors";
import { runShopifySyncForMerchant } from "@/lib/shopifySyncRunner";
import { getMerchantSyncAuditContext } from "@/lib/syncShopifyOrders";

function buildSyncAuditMeta(syncContext, extra = {}) {
  return sanitizeAuditMetadata({
    merchantId: syncContext?.merchantId ?? null,
    shopDomain: syncContext?.shopDomain ?? null,
    hasToken: syncContext?.hasToken ?? false,
    ...extra,
  });
}

async function handleShopifySyncRouteError(error, meta = {}) {
  const { syncContext, request } = meta;
  const requestContext = request
    ? getAuditRequestContext(request)
    : { ipAddress: null, userAgent: null };

  if (isProtectedCustomerDataError(error)) {
    logShopifySyncError("shopify-order-sync", error, syncContext);

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED,
      buildSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.SHOPIFY,
        endpoint: error?.endpoint ?? null,
        httpStatus: 403,
        code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      }),
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
      },
    );
  }

  const { code, httpStatus } = resolveSyncFailureAudit(error);
  const safeLogMeta = buildShopifySyncSafeLogMeta(error, syncContext);

  logShopifySyncError("shopify-order-sync", { ...error, code }, syncContext);

  logAuditInfo(
    AUDIT_EVENTS.SHOPIFY_SYNC_FAILED,
    buildSyncAuditMeta(syncContext, {
      actorType: AUDIT_ACTORS.SYSTEM,
      code,
      httpStatus,
      endpoint: safeLogMeta.endpoint,
      apiType: safeLogMeta.apiType,
      apiVersion: safeLogMeta.apiVersion,
      errorSummary: safeLogMeta.errorSummary,
    }),
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
      endpoint: safeLogMeta.endpoint,
      apiType: safeLogMeta.apiType,
      apiVersion: safeLogMeta.apiVersion,
      errorSummary: safeLogMeta.errorSummary,
      hasToken: syncContext?.hasToken ?? false,
    },
    ...requestContext,
  });

  const knownCodes = new Set([
    "SHOPIFY_TOKEN_INVALID",
    "SHOPIFY_ORDER_ACCESS_DENIED",
    "SHOPIFY_ENDPOINT_NOT_FOUND",
    "SHOPIFY_RATE_LIMITED",
    "SHOPIFY_NETWORK_ERROR",
    "SHOPIFY_UNAVAILABLE",
    "SHOPIFY_API_ERROR",
    "INNGEST_QUEUE_UNAVAILABLE",
    "INNGEST_QUEUE_ERROR",
  ]);

  if (knownCodes.has(code)) {
    return createApiErrorResponse(
      buildShopifySyncErrorMessage({ ...error, code }),
      httpStatus,
      code,
      buildShopifySyncErrorDetails({ ...error, code }, syncContext),
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
      }),
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext.merchantId,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_STARTED,
      actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      resourceType: "SHOPIFY_SYNC",
      message: "Shopify order sync started",
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
        "MISSING_SHOPIFY_CONNECTION",
      );
    }

    const syncSummary = await runShopifySyncForMerchant({
      merchantId: merchant.id,
      reason: "manual:dashboard-orders",
    });

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_SYNC_COMPLETED,
      buildSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.SYSTEM,
        synced: true,
        ordersSynced: syncSummary.ordersSynced,
        productsSynced: syncSummary.productsSynced,
      }),
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext.merchantId,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_COMPLETED,
      actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      resourceType: "SHOPIFY_SYNC",
      message: "Shopify order sync completed",
      metadata: {
        shopDomain: syncContext.shopDomain,
        synced: true,
        ordersSynced: syncSummary.ordersSynced,
        productsSynced: syncSummary.productsSynced,
      },
      ...requestContext,
    });

    return NextResponse.json({
      success: true,
      synced: true,
      message: "Shopify orders synced successfully",
      orders: syncSummary.orders,
      items: {
        totalSynced: syncSummary.orders?.itemsSynced ?? 0,
      },
      ordersSynced: syncSummary.ordersSynced,
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
