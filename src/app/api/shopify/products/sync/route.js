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
import { createApiErrorResponse } from "@/lib/errors";
import { requireMerchantForRoute } from "@/lib/merchantApi";
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

function buildProductSyncAuditMeta(syncContext, extra = {}) {
  return sanitizeAuditMetadata({
    merchantId: syncContext?.merchantId ?? null,
    shopDomain: syncContext?.shopDomain ?? null,
    hasToken: syncContext?.hasToken ?? false,
    ...extra,
  });
}

async function handleShopifyProductSyncRouteError(error, meta = {}) {
  const { syncContext, request } = meta;
  const requestContext = request
    ? getAuditRequestContext(request)
    : { ipAddress: null, userAgent: null };

  if (isProtectedCustomerDataError(error)) {
    logShopifySyncError("shopify-product-sync", error, syncContext);

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_FAILED,
      buildProductSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.MERCHANT,
        code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      }),
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext?.merchantId ?? null,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_FAILED,
      actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
      severity: ADMIN_AUDIT_SEVERITY.ERROR,
      resourceType: "SHOPIFY_PRODUCT_SYNC",
      message: "Shopify product sync failed",
      metadata: {
        shopDomain: syncContext?.shopDomain ?? null,
        code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
        hasToken: syncContext?.hasToken ?? false,
      },
      ...requestContext,
    });

    return createApiErrorResponse(
      "Shopify connection works, but product sync requires protected customer data access approval in Shopify Partner Dashboard.",
      403,
      "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
    );
  }

  const { code, httpStatus } = resolveSyncFailureAudit(error);
  const safeLogMeta = buildShopifySyncSafeLogMeta(error, syncContext);

  logShopifySyncError("shopify-product-sync", { ...error, code }, syncContext);

  logAuditInfo(
    AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_FAILED,
    buildProductSyncAuditMeta(syncContext, {
      actorType: AUDIT_ACTORS.MERCHANT,
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
    eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_FAILED,
    actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
    severity: ADMIN_AUDIT_SEVERITY.ERROR,
    resourceType: "SHOPIFY_PRODUCT_SYNC",
    message: "Shopify product sync failed",
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

  return createApiErrorResponse(
    buildShopifySyncErrorMessage(error),
    httpStatus,
    code,
  );
}

/**
 * POST /api/shopify/products/sync
 *
 * Sync Shopify products for the authenticated merchant only.
 * Request body is ignored — merchantId is never taken from the client.
 */
export async function POST(request) {
  let merchant = null;
  let syncContext = null;

  try {
    const auth = await requireMerchantForRoute();
    if (auth.response) {
      await logUnauthorizedApiAccess(request, {
        routeName: "shopify-products-sync",
        resourceId: "/api/shopify/products/sync",
        method: "POST",
      });

      return createApiErrorResponse("Unauthorized", 401, "UNAUTHORIZED");
    }

    merchant = auth.merchant;
    syncContext = await getMerchantSyncAuditContext(merchant.id);

    if (!syncContext.hasToken || !syncContext.shopDomain) {
      return createApiErrorResponse(
        "Missing Shopify connection",
        400,
        "MISSING_SHOPIFY_CONNECTION",
      );
    }

    const requestContext = getAuditRequestContext(request);

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_STARTED,
      buildProductSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.MERCHANT,
      }),
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext.merchantId,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_STARTED,
      actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      resourceType: "SHOPIFY_PRODUCT_SYNC",
      message: "Shopify product sync started",
      metadata: {
        shopDomain: syncContext.shopDomain,
        hasToken: syncContext.hasToken,
      },
      ...requestContext,
    });

    const syncSummary = await runShopifySyncForMerchant({
      merchantId: merchant.id,
      reason: "manual:dashboard-products",
    });

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_COMPLETED,
      buildProductSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.MERCHANT,
        synced: true,
        productsSynced: syncSummary.productsSynced,
      }),
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext.merchantId,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_COMPLETED,
      actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      resourceType: "SHOPIFY_PRODUCT_SYNC",
      message: "Shopify product sync completed",
      metadata: {
        shopDomain: syncContext.shopDomain,
        synced: true,
        productsSynced: syncSummary.productsSynced,
      },
      ...requestContext,
    });

    return NextResponse.json({
      success: true,
      synced: true,
      message: "Shopify products synced successfully",
      productsSynced: syncSummary.products?.productsSynced ?? 0,
      variantsSynced: syncSummary.products?.variantsSynced ?? 0,
      warnings: [],
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
      action: "shopify_products_sync",
    });

    return handleShopifyProductSyncRouteError(error, { syncContext, request });
  }
}
