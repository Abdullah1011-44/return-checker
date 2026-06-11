import {
  AUDIT_ACTORS,
  AUDIT_EVENTS,
  logAuditInfo,
  sanitizeAuditMetadata,
} from "@/lib/audit";
import {
  createApiErrorResponse,
  handleApiError,
  logSafeError,
} from "@/lib/errors";
import {
  getShopifyWebhookHeaders,
  verifyShopifyWebhookHmac,
} from "@/lib/shopifyWebhook";

/**
 * Shared helpers for Shopify-required GDPR/privacy compliance webhooks.
 * See: customers/data_request, customers/redact, shop/redact.
 */

export function buildWebhookAuditMeta(routeName, headers, extra = {}) {
  return sanitizeAuditMetadata({
    actorType: AUDIT_ACTORS.WEBHOOK,
    routeName,
    shopDomain: headers?.shopDomain ?? null,
    topic: headers?.topic ?? null,
    ...extra,
  });
}

/** Safe audit log when a webhook request is received (before body read). */
export function logWebhookReceived(routeName, request) {
  const headers = getShopifyWebhookHeaders(request);
  logAuditInfo(
    AUDIT_EVENTS.WEBHOOK_RECEIVED,
    buildWebhookAuditMeta(routeName, headers)
  );
}

/** Safe audit log when HMAC verification fails. */
export function logWebhookInvalidHmac(routeName, headers) {
  logAuditInfo(
    AUDIT_EVENTS.WEBHOOK_INVALID_HMAC,
    buildWebhookAuditMeta(routeName, headers, { reason: "Invalid HMAC" })
  );
}

/** Read raw body, verify HMAC, then parse JSON. Never parse before verification. */
export async function readVerifiedShopifyWebhook(request, routeName) {
  const rawBody = await request.text();
  const headers = getShopifyWebhookHeaders(request);
  const hmacCheck = verifyShopifyWebhookHmac(rawBody, headers.hmac);

  if (!hmacCheck.valid) {
    logWebhookInvalidHmac(routeName, headers);

    return {
      ok: false,
      response: invalidWebhookHmacResponse(),
    };
  }

  const payload = JSON.parse(rawBody);

  return { ok: true, headers, payload };
}

export function invalidWebhookHmacResponse() {
  return createApiErrorResponse("Unauthorized", 401, "INVALID_WEBHOOK_HMAC");
}

export function logWebhookError(routeName, error, meta = {}) {
  console.error("[Shopify Webhook]", {
    route: routeName,
    topic: meta.topic ?? null,
    shopDomain: meta.shopDomain ?? null,
  });

  logSafeError(routeName, error);
}

export function handleWebhookRouteError(routeName, error, meta = {}) {
  logWebhookError(routeName, error, meta);

  return handleApiError(error, {
    context: routeName,
    fallbackMessage: "Webhook processing failed",
    fallbackCode: "WEBHOOK_ERROR",
  });
}

export function logCustomerFromPayload(payload) {
  if (payload?.customer) {
    console.log("[shopify-compliance-webhook] customer data present in payload");
  }
}

/** Resolve shop domain from webhook headers or payload fields. */
export function resolveShopDomain(headers, payload) {
  return (
    headers.shopDomain ||
    payload?.shop_domain ||
    payload?.myshopify_domain ||
    null
  );
}
