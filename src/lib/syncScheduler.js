import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
  safeCreateAdminAuditLog,
} from "@/lib/adminAudit";
import { AUDIT_ACTORS, AUDIT_EVENTS, logAuditInfo, sanitizeAuditMetadata } from "@/lib/audit";
import { findActiveMerchantsForSync } from "@/lib/shopifySyncRunner";
import { queueShopifySyncForMerchant } from "@/lib/shopifySyncQueue";

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

  return "Shopify sync scheduler queue failure";
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

async function logSchedulerMerchantQueued(merchant, queueResult) {
  const metadata = buildSchedulerAuditMeta({
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    reason: queueResult.reason,
    requestedAt: queueResult.requestedAt,
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
    message: "Shopify sync scheduler merchant job queued",
    metadata,
  });
}

async function logSchedulerMerchantQueueFailed(merchant, error) {
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
    message: "Shopify sync scheduler merchant queue failed",
    metadata,
  });
}

async function logSchedulerFinished(trigger, summary) {
  const metadata = buildSchedulerAuditMeta({
    trigger,
    merchantCount: summary.merchantCount,
    queuedCount: summary.queuedCount,
    skippedCount: summary.skippedCount,
    errorCount: summary.errorCount,
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
 * Queue Shopify sync jobs for active merchants via Inngest.
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
      const queueResult = await queueShopifySyncForMerchant({
        merchantId: merchant.id,
        reason: `scheduler:${trigger}`,
      });

      results.push({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
        ok: true,
        queued: true,
        reason: queueResult.reason,
        requestedAt: queueResult.requestedAt,
        error: null,
      });

      await logSchedulerMerchantQueued(merchant, queueResult);
    } catch (error) {
      results.push({
        merchantId: merchant.id,
        shopDomain: merchant.shopDomain,
        ok: false,
        queued: false,
        reason: null,
        requestedAt: null,
        error: safeErrorMessage(error),
      });

      await logSchedulerMerchantQueueFailed(merchant, error);
    }
  }

  const finishedAt = new Date();
  const queuedCount = results.filter((result) => result.ok).length;
  const errorCount = results.length - queuedCount;
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  await logSchedulerFinished(trigger, {
    merchantCount: results.length,
    queuedCount,
    skippedCount: 0,
    errorCount,
    durationMs,
  });

  return {
    ok: true,
    trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs,
    merchantCount: results.length,
    queuedCount,
    skippedCount: 0,
    errorCount,
    results,
  };
}
