import { prisma } from "@/lib/prisma";

/**
 * Reusable audit logging helpers.
 *
 * ReturnEvent is for return-request-level audit logs persisted in Postgres.
 * logAuditInfo is for safe merchant/system console logs until MerchantAuditEvent
 * is added later.
 *
 * Audit logging must never break the main user flow — use safeCreateAuditEvent
 * in API routes and background tasks.
 */

export const AUDIT_EVENTS = {
  RETURN_SUBMITTED: "RETURN_SUBMITTED",
  MERCHANT_ACTION_APPROVE: "MERCHANT_ACTION_APPROVE",
  MERCHANT_ACTION_REJECT: "MERCHANT_ACTION_REJECT",
  MERCHANT_ACTION_NEEDS_MORE_INFO: "MERCHANT_ACTION_NEEDS_MORE_INFO",
  MERCHANT_ACTION_RESOLVE: "MERCHANT_ACTION_RESOLVE",
  EMAIL_SENT: "EMAIL_SENT",
  EMAIL_FAILED: "EMAIL_FAILED",
  SHOPIFY_SYNC_STARTED: "SHOPIFY_SYNC_STARTED",
  SHOPIFY_SYNC_COMPLETED: "SHOPIFY_SYNC_COMPLETED",
  SHOPIFY_SYNC_FAILED: "SHOPIFY_SYNC_FAILED",
  SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED:
    "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  WEBHOOK_INVALID_HMAC: "WEBHOOK_INVALID_HMAC",
  APP_UNINSTALLED: "APP_UNINSTALLED",
  GENERIC_ERROR: "GENERIC_ERROR",
};

export const AUDIT_ACTORS = {
  CUSTOMER: "CUSTOMER",
  MERCHANT: "MERCHANT",
  SYSTEM: "SYSTEM",
  SHOPIFY: "SHOPIFY",
  WEBHOOK: "WEBHOOK",
};

const DANGEROUS_KEY_MARKERS = [
  "accessToken",
  "shopifyAccessToken",
  "authorization",
  "password",
  "secret",
  "apiKey",
  "RESEND_API_KEY",
  "SHOPIFY_API_SECRET",
  "DATABASE_URL",
  "rawBody",
  "headers",
  "hmac",
  "cookie",
];

const SAFE_METADATA_KEYS = new Set([
  "hasToken",
  "hasApiKey",
  "hasFrom",
  "toProvided",
  "subjectProvided",
]);

function isDangerousMetadataKey(key) {
  if (SAFE_METADATA_KEYS.has(key)) {
    return false;
  }

  const normalized = String(key).toLowerCase();

  if (normalized === "token") {
    return true;
  }

  return DANGEROUS_KEY_MARKERS.some((marker) =>
    normalized.includes(marker.toLowerCase())
  );
}

function sanitizeAuditValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item !== null && typeof item === "object"
        ? sanitizeAuditMetadata(item)
        : item
    );
  }

  if (value !== null && typeof value === "object") {
    return sanitizeAuditMetadata(value);
  }

  return value;
}

/**
 * Strip secrets and sensitive fields from audit metadata before save or log.
 */
export function sanitizeAuditMetadata(metadata) {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const safe = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (isDangerousMetadataKey(key)) {
      continue;
    }

    safe[key] = sanitizeAuditValue(value);
  }

  return safe;
}

/**
 * Persist a ReturnEvent row. Requires returnRequestId and eventType.
 * Returns null without throwing when required fields are missing.
 */
export async function createAuditEvent({
  returnRequestId,
  actorType = AUDIT_ACTORS.SYSTEM,
  actorUserId = null,
  eventType,
  fromValue = null,
  toValue = null,
  note = null,
  metadata = {},
}) {
  if (!returnRequestId || !eventType) {
    return null;
  }

  const sanitizedMetadata = sanitizeAuditMetadata(metadata);

  return prisma.returnEvent.create({
    data: {
      returnRequestId,
      actorType,
      ...(actorUserId ? { actorUserId } : {}),
      eventType,
      fromValue,
      toValue,
      note,
      ...(Object.keys(sanitizedMetadata).length > 0
        ? { metadata: sanitizedMetadata }
        : {}),
    },
  });
}

/**
 * Non-blocking wrapper for createAuditEvent.
 * Main app flow continues even when audit persistence fails.
 */
export async function safeCreateAuditEvent(args) {
  try {
    return await createAuditEvent(args);
  } catch {
    console.warn("[Audit] Failed to create audit event");
    return null;
  }
}

/**
 * Safe console audit log for merchant/system activity without a returnRequestId.
 */
export function logAuditInfo(eventType, metadata = {}) {
  const safeMetadata = sanitizeAuditMetadata(metadata);
  console.log(`[Audit] ${eventType}`, safeMetadata);
}
