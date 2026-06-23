import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_SEVERITY,
  safeCreateAdminAuditLog,
  sanitizeAdminAuditMetadata,
} from "@/lib/adminAudit";
import { logAuditInfo } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  getShopifyWebhookHeaders,
  verifyShopifyWebhookHmac,
} from "@/lib/shopifyWebhook";

const WEBHOOK_PII_KEYS = new Set([
  "email",
  "customeremail",
  "phone",
  "customerphone",
  "address",
  "shippingaddress",
  "billingaddress",
  "customername",
  "customer",
  "first_name",
  "last_name",
  "name",
  "rawbody",
  "raw_body",
  "payload",
  "body",
  "accesstoken",
  "shopifyaccesstoken",
  "authorization",
]);

/**
 * Strip customer PII and secrets from webhook audit metadata.
 */
export function sanitizeWebhookAuditMetadata(metadata) {
  const sanitized = sanitizeAdminAuditMetadata(metadata);

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const safe = {};

  for (const [key, value] of Object.entries(sanitized)) {
    if (WEBHOOK_PII_KEYS.has(String(key).toLowerCase())) {
      continue;
    }

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      safe[key] = sanitizeWebhookAuditMetadata(value);
      continue;
    }

    safe[key] = value;
  }

  return safe;
}

/**
 * Read the raw webhook request body as text.
 * Must be called before JSON.parse so HMAC verification stays valid.
 *
 * @param {Request} request
 * @returns {Promise<string>}
 */
export async function readRawBody(request) {
  try {
    const text = await request.text();
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

/**
 * Verify Shopify webhook HMAC and read the shop domain header.
 * Never parse JSON before this succeeds.
 *
 * @param {Request} request
 * @param {string} rawBody
 * @returns {{ valid: boolean, shopDomain: string | null, error: string | null }}
 */
export function verifyIncomingShopifyWebhook(request, rawBody) {
  const headers = getShopifyWebhookHeaders(request);
  const hmacCheck = verifyShopifyWebhookHmac(rawBody, headers.hmac);
  const shopDomain = headers.shopDomain?.trim().toLowerCase() || null;

  if (!hmacCheck.valid) {
    return {
      valid: false,
      shopDomain,
      error: "Invalid webhook HMAC",
    };
  }

  return {
    valid: true,
    shopDomain,
    error: null,
  };
}

/**
 * Safely parse a verified webhook body as JSON.
 *
 * @param {string} rawBody
 * @returns {{ success: boolean, data: object | null, error: string | null }}
 */
export function parseWebhookJson(rawBody) {
  if (typeof rawBody !== "string" || rawBody.trim() === "") {
    return {
      success: false,
      data: null,
      error: "Invalid webhook payload",
    };
  }

  try {
    const data = JSON.parse(rawBody);

    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      return {
        success: false,
        data: null,
        error: "Invalid webhook payload",
      };
    }

    return {
      success: true,
      data,
      error: null,
    };
  } catch {
    return {
      success: false,
      data: null,
      error: "Invalid webhook payload",
    };
  }
}

/**
 * Resolve the active merchant for an incoming webhook shop domain.
 *
 * @param {string | null | undefined} shopDomain
 */
export async function getWebhookMerchant(shopDomain) {
  if (!shopDomain || typeof shopDomain !== "string") {
    return null;
  }

  const normalizedShopDomain = shopDomain.trim().toLowerCase();
  if (!normalizedShopDomain) {
    return null;
  }

  return prisma.merchant.findFirst({
    where: {
      shopDomain: normalizedShopDomain,
      isActive: true,
    },
    select: {
      id: true,
      shopDomain: true,
      shopName: true,
      isActive: true,
    },
  });
}

/**
 * Persist a safe webhook audit log without breaking webhook processing.
 *
 * @param {{
 *   merchantId?: string | null,
 *   action: string,
 *   metadata?: Record<string, unknown>
 * }} params
 */
export async function createWebhookAuditLog({
  merchantId = null,
  action,
  metadata = {},
}) {
  if (!action) {
    return null;
  }

  const safeMetadata = sanitizeWebhookAuditMetadata(metadata);

  logAuditInfo(action, safeMetadata);

  if (!merchantId) {
    return null;
  }

  try {
    return await safeCreateAdminAuditLog({
      merchantId,
      actorType: ADMIN_AUDIT_ACTORS.WEBHOOK,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      eventType: action,
      resourceType: "SHOPIFY_WEBHOOK",
      message: "Shopify webhook processed",
      metadata: safeMetadata,
    });
  } catch {
    console.warn("[Shopify Webhook] Failed to create webhook audit log");
    return null;
  }
}
