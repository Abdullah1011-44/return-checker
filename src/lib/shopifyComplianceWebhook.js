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

/** Read raw body, verify HMAC, then parse JSON. Never parse before verification. */
export async function readVerifiedShopifyWebhook(request) {
  const rawBody = await request.text();
  const headers = getShopifyWebhookHeaders(request);
  const hmacCheck = verifyShopifyWebhookHmac(rawBody, headers.hmac);

  if (!hmacCheck.valid) {
    return {
      ok: false,
      response: invalidWebhookHmacResponse(),
    };
  }

  const payload = JSON.parse(rawBody);
  logComplianceWebhook(headers);

  return { ok: true, headers, payload };
}

/** Development logging for incoming compliance webhooks. */
export function logComplianceWebhook(headers) {
  console.log("[shopify-compliance-webhook]", {
    topic: headers.topic,
    shopDomain: headers.shopDomain,
    webhookId: headers.webhookId,
  });
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
