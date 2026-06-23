import { AUDIT_EVENTS, logAuditInfo, sanitizeAuditMetadata } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/**
 * Admin/system/merchant-level audit logging via AdminAuditLog.
 *
 * AdminAuditLog is for merchant/system/admin events (Shopify sync, webhooks,
 * auth failures, rate limits, etc.).
 * ReturnEvent remains for return-request-level events tied to returnRequestId.
 *
 * Use safeCreateAdminAuditLog in API routes so audit failures never break
 * the main user flow.
 */

export const ADMIN_AUDIT_EVENTS = {
  SHOPIFY_SYNC_STARTED: "SHOPIFY_SYNC_STARTED",
  SHOPIFY_SYNC_COMPLETED: "SHOPIFY_SYNC_COMPLETED",
  SHOPIFY_SYNC_FAILED: "SHOPIFY_SYNC_FAILED",
  ORDER_STATUS_UPDATED: "ORDER_STATUS_UPDATED",
  SHOPIFY_PRODUCTS_SYNC_STARTED: "SHOPIFY_PRODUCTS_SYNC_STARTED",
  SHOPIFY_PRODUCTS_SYNC_COMPLETED: "SHOPIFY_PRODUCTS_SYNC_COMPLETED",
  SHOPIFY_PRODUCTS_SYNC_FAILED: "SHOPIFY_PRODUCTS_SYNC_FAILED",
  SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED:
    "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  WEBHOOK_INVALID_HMAC: "WEBHOOK_INVALID_HMAC",
  WEBHOOKS_REGISTERED: "WEBHOOKS_REGISTERED",
  ORDER_CREATED_WEBHOOK: "ORDER_CREATED_WEBHOOK",
  ORDER_UPDATED_WEBHOOK: "ORDER_UPDATED_WEBHOOK",
  ORDER_UPDATED_WEBHOOK_IGNORED: "ORDER_UPDATED_WEBHOOK_IGNORED",
  FULFILLMENT_CREATED_WEBHOOK: "FULFILLMENT_CREATED_WEBHOOK",
  PRODUCT_UPDATED_WEBHOOK: "PRODUCT_UPDATED_WEBHOOK",
  APP_UNINSTALLED: "APP_UNINSTALLED",
  CUSTOMERS_DATA_REQUEST: "CUSTOMERS_DATA_REQUEST",
  CUSTOMERS_REDACT: "CUSTOMERS_REDACT",
  SHOP_REDACT: "SHOP_REDACT",
  UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  RATE_LIMIT_TRIGGERED: "RATE_LIMIT_TRIGGERED",
  SERVER_CONFIG_ERROR: "SERVER_CONFIG_ERROR",
  ADMIN_ACTION: "ADMIN_ACTION",
  GENERIC_ERROR: "GENERIC_ERROR",
};

export const ADMIN_AUDIT_ACTORS = {
  ADMIN: "ADMIN",
  MERCHANT: "MERCHANT",
  CUSTOMER: "CUSTOMER",
  SYSTEM: "SYSTEM",
  SHOPIFY: "SHOPIFY",
  WEBHOOK: "WEBHOOK",
};

export const ADMIN_AUDIT_SEVERITY = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
  SECURITY: "SECURITY",
};

/**
 * Strip secrets and sensitive fields from admin audit metadata before save.
 * Reuses the same sanitizer as return-request audit logs.
 */
export function sanitizeAdminAuditMetadata(metadata) {
  return sanitizeAuditMetadata(metadata);
}

/**
 * Extract safe request context for admin audit logs.
 * Never includes cookies or authorization headers.
 */
export function getAuditRequestContext(request) {
  if (!request?.headers) {
    return { ipAddress: null, userAgent: null };
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  let ipAddress = null;

  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      ipAddress = firstIp;
    }
  }

  if (!ipAddress) {
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) {
      ipAddress = realIp;
    }
  }

  const userAgent = request.headers.get("user-agent")?.trim() || null;

  return { ipAddress, userAgent };
}

/**
 * Persist an AdminAuditLog row.
 * Returns null without throwing when eventType is missing.
 */
export async function createAdminAuditLog({
  merchantId = null,
  actorType = ADMIN_AUDIT_ACTORS.SYSTEM,
  actorUserId = null,
  eventType,
  severity = ADMIN_AUDIT_SEVERITY.INFO,
  resourceType = null,
  resourceId = null,
  message = null,
  metadata = {},
  ipAddress = null,
  userAgent = null,
}) {
  if (!eventType) {
    console.warn("[AdminAudit] Missing eventType — audit log skipped");
    return null;
  }

  const sanitizedMetadata = sanitizeAdminAuditMetadata(metadata);

  return prisma.adminAuditLog.create({
    data: {
      ...(merchantId ? { merchantId } : {}),
      actorType,
      ...(actorUserId ? { actorUserId } : {}),
      eventType,
      severity,
      resourceType,
      resourceId,
      message,
      ...(Object.keys(sanitizedMetadata).length > 0
        ? { metadata: sanitizedMetadata }
        : {}),
      ipAddress,
      userAgent,
    },
  });
}

/**
 * Non-blocking wrapper for createAdminAuditLog.
 * Main app flow continues even when admin audit persistence fails.
 */
export async function safeCreateAdminAuditLog(args) {
  try {
    return await createAdminAuditLog(args);
  } catch {
    console.warn("[AdminAudit] Failed to create admin audit log");
    return null;
  }
}

/**
 * Persist a safe unauthorized API access attempt for merchant-protected routes.
 */
export async function logUnauthorizedApiAccess(
  request,
  { routeName, resourceId = null, method = null, reason = "Missing or invalid merchant session" }
) {
  await safeCreateAdminAuditLog({
    eventType: ADMIN_AUDIT_EVENTS.UNAUTHORIZED_ACCESS,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: ADMIN_AUDIT_SEVERITY.SECURITY,
    resourceType: "API_ROUTE",
    resourceId: resourceId ?? routeName,
    message: "Unauthorized API access attempt",
    metadata: sanitizeAdminAuditMetadata({
      routeName,
      method: method ?? request?.method ?? "UNKNOWN",
      reason,
    }),
    ...getAuditRequestContext(request),
  });
}

/**
 * Log a customer order status change from Shopify sync.
 * Skips when status is unchanged.
 */
export async function logOrderStatusUpdated({
  merchantId,
  orderId,
  oldStatus,
  newStatus,
}) {
  if (!merchantId || !orderId || !oldStatus || !newStatus || oldStatus === newStatus) {
    return null;
  }

  const metadata = sanitizeAdminAuditMetadata({
    merchantId,
    orderId,
    oldStatus,
    newStatus,
  });

  logAuditInfo(AUDIT_EVENTS.ORDER_STATUS_UPDATED, metadata);

  return safeCreateAdminAuditLog({
    merchantId,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: ADMIN_AUDIT_SEVERITY.INFO,
    eventType: ADMIN_AUDIT_EVENTS.ORDER_STATUS_UPDATED,
    resourceType: "CUSTOMER_ORDER",
    resourceId: orderId,
    message: "Order status updated from Shopify sync",
    metadata,
  });
}
