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
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import { syncShopifyProductsForMerchant } from "@/lib/shopifyProductSync";
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

      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    merchant = auth.merchant;
    syncContext = await getMerchantSyncAuditContext(merchant.id);

    const shopifyMerchant = await prisma.merchant.findUnique({
      where: { id: merchant.id },
      select: {
        id: true,
        shopDomain: true,
        shopifyAccessToken: true,
      },
    });

    if (!shopifyMerchant?.shopDomain || !shopifyMerchant?.shopifyAccessToken) {
      return NextResponse.json(
        { success: false, error: "Missing Shopify connection" },
        { status: 400 }
      );
    }

    const requestContext = getAuditRequestContext(request);

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_STARTED,
      buildProductSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.MERCHANT,
      })
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

    const result = await syncShopifyProductsForMerchant({
      id: shopifyMerchant.id,
      shopDomain: shopifyMerchant.shopDomain,
      accessToken: shopifyMerchant.shopifyAccessToken,
    });

    logAuditInfo(
      AUDIT_EVENTS.SHOPIFY_PRODUCTS_SYNC_COMPLETED,
      buildProductSyncAuditMeta(syncContext, {
        actorType: AUDIT_ACTORS.MERCHANT,
        productsSynced: result.productsSynced,
        variantsSynced: result.variantsSynced,
        pagesSynced: result.pagesSynced,
        warningCount: result.warnings?.length ?? 0,
      })
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
        productsSynced: result.productsSynced,
        variantsSynced: result.variantsSynced,
        pagesSynced: result.pagesSynced,
        warningCount: result.warnings?.length ?? 0,
      },
      ...requestContext,
    });

    return NextResponse.json({
      success: true,
      productsSynced: result.productsSynced,
      variantsSynced: result.variantsSynced,
      pagesSynced: result.pagesSynced,
      warnings: result.warnings ?? [],
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
      })
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
      fallbackMessage: "Unable to sync Shopify products. Please try again.",
      fallbackCode: "SHOPIFY_PRODUCTS_SYNC_ERROR",
    });
  }
}
