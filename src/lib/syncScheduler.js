import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
  safeCreateAdminAuditLog,
} from "@/lib/adminAudit";
import { AUDIT_ACTORS, AUDIT_EVENTS, logAuditInfo, sanitizeAuditMetadata } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { syncShopifyProductsForMerchant } from "@/lib/shopifyProductSync";
import {
  summarizeOrderStatusSyncFromOrders,
  syncShopifyOrdersForMerchant,
} from "@/lib/syncShopifyOrders";

const DEFAULT_MERCHANT_LIMIT = 10;
const MAX_MERCHANT_LIMIT = 25;

function buildSchedulerAuditMeta(extra = {}) {
  return sanitizeAuditMetadata(extra);
}

function resolveMerchantLimit(merchantLimit) {
  if (typeof merchantLimit !== "number" || !Number.isFinite(merchantLimit)) {
    return DEFAULT_MERCHANT_LIMIT;
  }

  const rounded = Math.floor(merchantLimit);
  if (rounded < 1) {
    return DEFAULT_MERCHANT_LIMIT;
  }

  return Math.min(rounded, MAX_MERCHANT_LIMIT);
}

function resolveTrigger(trigger) {
  return trigger === "cron" ? "cron" : "manual";
}

function safeErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Shopify sync scheduler merchant failure";
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

async function findActiveMerchantsForSync(limit) {
  const merchants = await prisma.merchant.findMany({
    where: {
      isActive: true,
      shopDomain: { not: null },
      shopifyAccessToken: { not: null },
    },
    select: {
      id: true,
      shopDomain: true,
      shopifyAccessToken: true,
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  return merchants.filter(
    (merchant) =>
      typeof merchant.shopDomain === "string" &&
      merchant.shopDomain.trim() !== "" &&
      typeof merchant.shopifyAccessToken === "string" &&
      merchant.shopifyAccessToken.trim() !== ""
  );
}

async function syncShopifyDataForMerchant(merchant) {
  const orders = await syncShopifyOrdersForMerchant(merchant);

  const products = await syncShopifyProductsForMerchant({
    id: merchant.id,
    shopDomain: merchant.shopDomain,
    accessToken: merchant.shopifyAccessToken,
  });

  return {
    orders: summarizeOrdersResult(orders),
    products: summarizeProductsResult(products),
    orderStatuses: summarizeOrderStatusSyncFromOrders(orders),
  };
}

async function logSchedulerStarted(trigger, merchantLimit) {
  const metadata = buildSchedulerAuditMeta({ trigger, merchantLimit });

  logAuditInfo(AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_STARTED, {
    actorType: AUDIT_ACTORS.SYSTEM,
    ...metadata,
  });

  await safeCreateAdminAuditLog({
    eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_STARTED,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: ADMIN_AUDIT_SEVERITY.INFO,
    resourceType: "SHOPIFY_SYNC_SCHEDULER",
    message: "Shopify sync scheduler started",
    metadata,
  });
}

async function logSchedulerMerchantSuccess(merchant, summary) {
  const metadata = buildSchedulerAuditMeta({
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    ordersCreated: summary.orders?.created ?? 0,
    ordersUpdated: summary.orders?.updated ?? 0,
    productsSynced: summary.products?.productsSynced ?? 0,
    orderStatusesUpdated: summary.orderStatuses?.updated ?? 0,
  });

  logAuditInfo(AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_MERCHANT_SUCCESS, {
    actorType: AUDIT_ACTORS.SYSTEM,
    ...metadata,
  });

  await safeCreateAdminAuditLog({
    merchantId: merchant.id,
    eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_MERCHANT_SUCCESS,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: ADMIN_AUDIT_SEVERITY.INFO,
    resourceType: "SHOPIFY_SYNC_SCHEDULER",
    message: "Shopify sync scheduler merchant sync completed",
    metadata,
  });
}

async function logSchedulerMerchantFailed(merchant, error) {
  const metadata = buildSchedulerAuditMeta({
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    code: error?.code ?? null,
    message: safeErrorMessage(error),
  });

  logAuditInfo(AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_MERCHANT_FAILED, {
    actorType: AUDIT_ACTORS.SYSTEM,
    ...metadata,
  });

  await safeCreateAdminAuditLog({
    merchantId: merchant.id,
    eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_MERCHANT_FAILED,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: ADMIN_AUDIT_SEVERITY.ERROR,
    resourceType: "SHOPIFY_SYNC_SCHEDULER",
    message: "Shopify sync scheduler merchant sync failed",
    metadata,
  });
}

async function logSchedulerFinished(trigger, summary) {
  const metadata = buildSchedulerAuditMeta({
    trigger,
    merchantCount: summary.merchantCount,
    successCount: summary.successCount,
    failureCount: summary.failureCount,
    durationMs: summary.durationMs,
  });

  logAuditInfo(AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_FINISHED, {
    actorType: AUDIT_ACTORS.SYSTEM,
    ...metadata,
  });

  await safeCreateAdminAuditLog({
    eventType: ADMIN_AUDIT_EVENTS.SHOPIFY_SYNC_SCHEDULER_FINISHED,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: ADMIN_AUDIT_SEVERITY.INFO,
    resourceType: "SHOPIFY_SYNC_SCHEDULER",
    message: "Shopify sync scheduler finished",
    metadata,
  });
}

/**
 * Run Shopify order, order-status, and product sync for active merchants.
 * Merchants are processed sequentially to reduce serverless timeout risk.
 *
 * @param {{ trigger?: "manual" | "cron", merchantLimit?: number }} [options]
 */
export async function runShopifySyncScheduler(options = {}) {
  const trigger = resolveTrigger(options.trigger);
  const merchantLimit = resolveMerchantLimit(options.merchantLimit);
  const startedAt = new Date();

  await logSchedulerStarted(trigger, merchantLimit);

  const merchants = await findActiveMerchantsForSync(merchantLimit);
  const results = [];

  for (const merchant of merchants) {
    try {
      const summary = await syncShopifyDataForMerchant(merchant);

      results.push({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
        ok: true,
        orders: summary.orders,
        products: summary.products,
        orderStatuses: summary.orderStatuses,
        error: null,
      });

      await logSchedulerMerchantSuccess(merchant, summary);
    } catch (error) {
      results.push({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
        ok: false,
        orders: null,
        products: null,
        orderStatuses: null,
        error: safeErrorMessage(error),
      });

      await logSchedulerMerchantFailed(merchant, error);
    }
  }

  const finishedAt = new Date();
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - successCount;
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  await logSchedulerFinished(trigger, {
    merchantCount: results.length,
    successCount,
    failureCount,
    durationMs,
  });

  return {
    ok: true,
    trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    merchantCount: results.length,
    results,
  };
}
