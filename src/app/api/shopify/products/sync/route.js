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
import { handleApiError } from "@/lib/errors";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { captureException } from "@/lib/sentry";
import { queueShopifySyncForMerchant } from "@/lib/shopifySyncQueue";
import { getMerchantSyncAuditContext } from "@/lib/syncShopifyOrders";

function buildProductSyncAuditMeta(syncContext, extra = {}) {
  return sanitizeAuditMetadata({
    merchantId: syncContext?.merchantId ?? null,
    shopDomain: syncContext?.shopDomain ?? null,
    hasToken: syncContext?.hasToken ?? false,
    ...extra,
  });
}

/**
 * POST /api/shopify/products/sync
 *
 * Queue Shopify sync for the authenticated merchant only.
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

      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    merchant = auth.merchant;
    syncContext = await getMerchantSyncAuditContext(merchant.id);

    if (!syncContext.hasToken || !syncContext.shopDomain) {
      return NextResponse.json(
        { success: false, error: "Missing Shopify connection" },
        { status: 400 },
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
      message: "Shopify product sync queued",
      metadata: {
        shopDomain: syncContext.shopDomain,
        hasToken: syncContext.hasToken,
      },
      ...requestContext,
    });

    const queueResult = await queueShopifySyncForMerchant({
      merchantId: merchant.id,
      reason: "manual:dashboard-products",
    });

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_COMPLETED,
      buildProductSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.MERCHANT,
        queued: true,
        requestedAt: queueResult.requestedAt,
      }),
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext.merchantId,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_COMPLETED,
      actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      resourceType: "SHOPIFY_PRODUCT_SYNC",
      message: "Shopify product sync queued",
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

    const requestContext = getAuditRequestContext(request);

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_FAILED,
      buildProductSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.MERCHANT,
        code: error?.code ?? "SHOPIFY_PRODUCTS_SYNC_ERROR",
      }),
    );

    await safeCreateAdminAuditLog({
      merchantId: syncContext?.merchantId ?? null,
      eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_FAILED,
      actorType: ADMIN_AUDIT_ACTORS.MERCHANT,
      severity: ADMIN_AUDIT_SEVERITY.ERROR,
      resourceType: "SHOPIFY_PRODUCT_SYNC",
      message: "Shopify product sync queue failed",
      metadata: {
        shopDomain: syncContext?.shopDomain ?? null,
        code: error?.code ?? "SHOPIFY_PRODUCTS_SYNC_ERROR",
        httpStatus: error?.status ?? null,
      },
      ...requestContext,
    });

    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id || syncContext?.merchantId || null,
      shopDomain: merchant?.shopDomain || syncContext?.shopDomain || null,
      action: "shopify_products_sync",
    });

    return handleApiError(error, {
      context: "shopify-products-sync",
      fallbackMessage:
        "Unable to queue Shopify product sync. Please try again.",
      fallbackCode: "SHOPIFY_PRODUCTS_SYNC_ERROR",
    });
  }
}
