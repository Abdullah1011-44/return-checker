import { sanitizeAuditMetadata } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { syncShopifyProductsForMerchant } from "@/lib/shopifyProductSync";
import {
  summarizeOrderStatusSyncFromOrders,
  syncShopifyOrdersForMerchant,
} from "@/lib/syncShopifyOrders";

const NON_RETRYABLE_CODES = new Set([
  "INVALID_MERCHANT_ID",
  "MERCHANT_NOT_FOUND",
  "MERCHANT_INACTIVE",
  "MERCHANT_MISSING_SHOP_DOMAIN",
  "MERCHANT_MISSING_ACCESS_TOKEN",
]);

/**
 * Sanitized error for queue/scheduler callers. Safe to surface to Inngest retries.
 */
export class ShopifySyncRunnerError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ShopifySyncRunnerError";
    this.code = options.code ?? "SHOPIFY_SYNC_RUNNER_ERROR";
    this.merchantId = options.merchantId ?? null;
    this.shopDomain = options.shopDomain ?? null;
    this.retryable = options.retryable ?? !NON_RETRYABLE_CODES.has(this.code);
    this.status = options.status ?? null;
    this.endpoint = options.endpoint ?? null;
    this.apiType = options.apiType ?? null;
    this.apiVersion = options.apiVersion ?? null;
    this.errorSummary = options.errorSummary ?? null;
  }
}

function safeErrorMessage(error) {
  if (error instanceof ShopifySyncRunnerError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Shopify sync failed";
}

function sanitizeRunnerError(error, context = {}) {
  if (error instanceof ShopifySyncRunnerError) {
    return error;
  }

  const code =
    typeof error?.code === "string" ? error.code : "SHOPIFY_SYNC_RUNNER_ERROR";

  return new ShopifySyncRunnerError(safeErrorMessage(error), {
    code,
    merchantId: context.merchantId ?? null,
    shopDomain: context.shopDomain ?? error?.shopDomain ?? null,
    retryable: !NON_RETRYABLE_CODES.has(code),
    status: error?.status ?? null,
    endpoint: error?.endpoint ?? null,
    apiType: error?.apiType ?? null,
    apiVersion: error?.apiVersion ?? null,
    errorSummary: error?.errorSummary ?? null,
  });
}

function summarizeOrdersResult(orderSyncResult) {
  if (!orderSyncResult) {
    return null;
  }

  return {
    created: orderSyncResult.orders?.created ?? 0,
    updated: orderSyncResult.orders?.updated ?? 0,
    skipped: orderSyncResult.orders?.skipped ?? 0,
    itemsSynced: orderSyncResult.items?.totalSynced ?? 0,
    pagesFetched: orderSyncResult.pagesFetched ?? 0,
  };
}

function summarizeProductsResult(productSyncResult) {
  if (!productSyncResult) {
    return null;
  }

  return {
    productsSynced: productSyncResult.productsSynced ?? 0,
    variantsSynced: productSyncResult.variantsSynced ?? 0,
    pagesSynced: productSyncResult.pagesSynced ?? 0,
    warningCount: productSyncResult.warnings?.length ?? 0,
  };
}

const MANUAL_PRODUCTS_SYNC_REASON = "manual:dashboard-products";
const MANUAL_ORDERS_SYNC_REASON = "manual:dashboard-orders";

function resolveSyncScope(reason) {
  const normalized =
    typeof reason === "string" && reason.trim() ? reason.trim() : null;

  if (normalized === MANUAL_PRODUCTS_SYNC_REASON) {
    return "products-only";
  }

  if (normalized === MANUAL_ORDERS_SYNC_REASON) {
    return "orders-only";
  }

  return "both";
}

export function buildSafeMerchantSyncSummary({
  merchant,
  orderSyncResult,
  productSyncResult,
  reason,
  success = true,
}) {
  const orders = summarizeOrdersResult(orderSyncResult);
  const products = summarizeProductsResult(productSyncResult);
  const orderStatuses = orderSyncResult
    ? summarizeOrderStatusSyncFromOrders(orderSyncResult)
    : null;

  return {
    success,
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    reason: reason ?? null,
    ordersSynced: (orders?.created ?? 0) + (orders?.updated ?? 0),
    productsSynced: products?.productsSynced ?? 0,
    statusUpdated: orderStatuses?.updated ?? 0,
    orders,
    products,
    orderStatuses,
  };
}

async function loadMerchantForSync(merchantId) {
  if (!merchantId || typeof merchantId !== "string") {
    throw new ShopifySyncRunnerError("Invalid merchant id", {
      code: "INVALID_MERCHANT_ID",
      retryable: false,
    });
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      shopDomain: true,
      shopifyAccessToken: true,
      isActive: true,
    },
  });

  if (!merchant) {
    throw new ShopifySyncRunnerError("Merchant not found", {
      code: "MERCHANT_NOT_FOUND",
      merchantId,
      retryable: false,
    });
  }

  if (!merchant.isActive) {
    throw new ShopifySyncRunnerError("Merchant is not active", {
      code: "MERCHANT_INACTIVE",
      merchantId: merchant.id,
      shopDomain: merchant.shopDomain,
      retryable: false,
    });
  }

  if (!merchant.shopDomain || merchant.shopDomain.trim() === "") {
    throw new ShopifySyncRunnerError("Merchant missing shop domain", {
      code: "MERCHANT_MISSING_SHOP_DOMAIN",
      merchantId: merchant.id,
      retryable: false,
    });
  }

  if (
    !merchant.shopifyAccessToken ||
    merchant.shopifyAccessToken.trim() === ""
  ) {
    throw new ShopifySyncRunnerError("Merchant missing Shopify access token", {
      code: "MERCHANT_MISSING_ACCESS_TOKEN",
      merchantId: merchant.id,
      shopDomain: merchant.shopDomain,
      retryable: false,
    });
  }

  return merchant;
}

/**
 * Load active merchants eligible for Shopify sync (scheduler / queue fan-out).
 *
 * @param {number} limit
 */
export async function findActiveMerchantsForSync(limit) {
  const merchants = await prisma.merchant.findMany({
    where: {
      isActive: true,
      shopDomain: { not: null },
    },
    select: {
      id: true,
      shopDomain: true,
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  return merchants.filter(
    (merchant) =>
      typeof merchant.shopDomain === "string" &&
      merchant.shopDomain.trim() !== "",
  );
}

/**
 * Run Shopify order, order-status, and product sync for one merchant.
 * Safe for Inngest/scheduler — loads merchant from DB; never trusts public input alone.
 *
 * Order status fields are updated during order sync (no separate Shopify fetch).
 * Existing upsert logic prevents duplicate orders/products/returns.
 *
 * @param {{ merchantId: string, reason?: string }} params
 */
export async function runShopifySyncForMerchant({ merchantId, reason } = {}) {
  console.log(
    "[Shopify Sync Runner] started",
    sanitizeAuditMetadata({
      merchantId: merchantId ?? null,
      reason: reason ?? null,
    }),
  );

  let merchant;

  try {
    merchant = await loadMerchantForSync(merchantId);
  } catch (error) {
    const sanitized = sanitizeRunnerError(error, { merchantId });
    console.error(
      "[Shopify Sync Runner] merchant validation failed",
      sanitizeAuditMetadata({
        merchantId: merchantId ?? null,
        code: sanitized.code,
        message: sanitized.message,
      }),
    );
    throw sanitized;
  }

  try {
    const syncScope = resolveSyncScope(reason);
    let orderSyncResult = null;
    let productSyncResult = null;

    if (syncScope === "both" || syncScope === "orders-only") {
      orderSyncResult = await syncShopifyOrdersForMerchant(merchant);
    }

    if (syncScope === "both" || syncScope === "products-only") {
      productSyncResult = await syncShopifyProductsForMerchant({
        id: merchant.id,
        shopDomain: merchant.shopDomain,
        accessToken: merchant.shopifyAccessToken,
      });
    }

    const summary = buildSafeMerchantSyncSummary({
      merchant,
      orderSyncResult,
      productSyncResult,
      reason,
      success: true,
    });

    console.log(
      "[Shopify Sync Runner] completed",
      sanitizeAuditMetadata({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
        reason: reason ?? null,
        ordersSynced: summary.ordersSynced,
        productsSynced: summary.productsSynced,
        statusUpdated: summary.statusUpdated,
      }),
    );

    return summary;
  } catch (error) {
    const sanitized = sanitizeRunnerError(error, {
      merchantId: merchant.id,
      shopDomain: merchant.shopDomain,
    });

    console.error(
      "[Shopify Sync Runner] sync failed",
      sanitizeAuditMetadata({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
        reason: reason ?? null,
        code: sanitized.code,
        message: sanitized.message,
      }),
    );

    throw sanitized;
  }
}
