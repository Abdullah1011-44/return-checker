import crypto from "node:crypto";

/**
 * Shopify webhook HMAC verification.
 *
 * Use this for POST /api/webhooks/* routes that receive Shopify event payloads.
 * This is NOT for OAuth install/callback flows — those use query-string HMAC
 * validation in shopifyOAuth.js (shopify.utils.validateHmac).
 *
 * Important: read the raw body with request.text() and verify HMAC before
 * calling JSON.parse(). Parsing first invalidates the signature check.
 *
 * Example (future webhook route):
 *
 *   import { NextResponse } from "next/server";
 *   import {
 *     getShopifyWebhookHeaders,
 *     verifyShopifyWebhookHmac,
 *   } from "@/lib/shopifyWebhook";
 *
 *   export async function POST(request) {
 *     const rawBody = await request.text();
 *     const { hmac } = getShopifyWebhookHeaders(request);
 *     const hmacCheck = verifyShopifyWebhookHmac(rawBody, hmac);
 *
 *     if (!hmacCheck.valid) {
 *       return NextResponse.json({ success: false }, { status: 401 });
 *     }
 *
 *     const payload = JSON.parse(rawBody);
 *     // handle webhook topic, shop domain, etc.
 *   }
 */

const WEBHOOK_HMAC_HEADER = "x-shopify-hmac-sha256";
const SHOP_DOMAIN_HEADER = "x-shopify-shop-domain";
const TOPIC_HEADER = "x-shopify-topic";
const WEBHOOK_ID_HEADER = "x-shopify-webhook-id";

/**
 * Read common Shopify webhook headers from an incoming Request.
 */
export function getShopifyWebhookHeaders(request) {
  return {
    hmac: request.headers.get(WEBHOOK_HMAC_HEADER),
    shopDomain: request.headers.get(SHOP_DOMAIN_HEADER),
    topic: request.headers.get(TOPIC_HEADER),
    webhookId: request.headers.get(WEBHOOK_ID_HEADER),
  };
}

/**
 * Verify the X-Shopify-Hmac-Sha256 header against the raw webhook body.
 *
 * @param {string} rawBody - Unparsed request body text (from request.text()).
 * @param {string | null | undefined} hmacHeader - Value of X-Shopify-Hmac-Sha256.
 * @returns {{ valid: true } | { valid: false, error: string }}
 */
export function verifyShopifyWebhookHmac(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_API_SECRET?.trim();

  if (!secret) {
    return { valid: false, error: "Invalid webhook HMAC" };
  }

  if (!hmacHeader || typeof hmacHeader !== "string") {
    return { valid: false, error: "Invalid webhook HMAC" };
  }

  if (typeof rawBody !== "string") {
    return { valid: false, error: "Invalid webhook HMAC" };
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const expected = Buffer.from(digest, "utf8");
  const received = Buffer.from(hmacHeader, "utf8");

  if (expected.length !== received.length) {
    return { valid: false, error: "Invalid webhook HMAC" };
  }

  const valid = crypto.timingSafeEqual(expected, received);

  if (!valid) {
    return { valid: false, error: "Invalid webhook HMAC" };
  }

  return { valid: true };
}
