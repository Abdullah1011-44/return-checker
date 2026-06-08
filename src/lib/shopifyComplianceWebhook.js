import { NextResponse } from "next/server";
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
      response: NextResponse.json(
        { success: false, message: "Invalid webhook HMAC" },
        { status: 401 }
      ),
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

export function logCustomerFromPayload(payload) {
  const customer = payload?.customer;
  if (!customer) {
    return;
  }

  if (customer.id != null) {
    console.log("[shopify-compliance-webhook] customer id:", customer.id);
  }

  if (customer.email) {
    console.log("[shopify-compliance-webhook] customer email:", customer.email);
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
