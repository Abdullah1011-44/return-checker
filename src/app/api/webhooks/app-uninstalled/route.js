import { NextResponse } from "next/server";
import {
  createApiErrorResponse,
  handleApiError,
  logSafeError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import {
  getShopifyWebhookHeaders,
  verifyShopifyWebhookHmac,
} from "@/lib/shopifyWebhook";

const ROUTE_NAME = "webhook-app-uninstalled";

function logWebhookError(error, meta = {}) {
  console.error("[Shopify Webhook]", {
    route: ROUTE_NAME,
    topic: meta.topic ?? null,
    shopDomain: meta.shopDomain ?? null,
  });

  logSafeError(ROUTE_NAME, error);
}

/**
 * Shopify app lifecycle webhook: app/uninstalled
 *
 * Fired when a merchant uninstalls the app. Marks the merchant inactive
 * without deleting records, return history, or exposing access tokens.
 */
export async function POST(request) {
  const webhookMeta = { topic: "app/uninstalled" };

  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: ROUTE_NAME,
      limit: 100,
      windowMs: 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult);
    }

    const rawBody = await request.text();
    const headers = getShopifyWebhookHeaders(request);
    const hmacCheck = verifyShopifyWebhookHmac(rawBody, headers.hmac);

    if (!hmacCheck.valid) {
      return createApiErrorResponse("Unauthorized", 401, "INVALID_WEBHOOK_HMAC");
    }

    const payload = JSON.parse(rawBody);

    const shopDomain =
      headers.shopDomain ||
      payload.myshopify_domain ||
      payload.shop_domain ||
      payload.domain ||
      null;

    webhookMeta.topic = headers.topic ?? webhookMeta.topic;
    webhookMeta.shopDomain = shopDomain;

    console.log("[shopify-app-uninstalled]", {
      topic: webhookMeta.topic,
      shopDomain: webhookMeta.shopDomain,
      webhookId: headers.webhookId,
    });

    let merchantFound = false;
    let merchantMarkedInactive = false;

    if (shopDomain) {
      const merchant = await prisma.merchant.findUnique({
        where: { shopDomain },
      });

      merchantFound = Boolean(merchant);

      if (merchant) {
        await prisma.merchant.update({
          where: { id: merchant.id },
          data: {
            isActive: false,
            shopifyUninstalledAt: new Date(),
          },
        });

        merchantMarkedInactive = true;
      }
    }

    console.log("[shopify-app-uninstalled]", {
      merchantFound,
      merchantMarkedInactive,
    });

    return NextResponse.json({
      success: true,
      topic: "app/uninstalled",
    });
  } catch (error) {
    logWebhookError(error, webhookMeta);

    return handleApiError(error, {
      context: ROUTE_NAME,
      fallbackMessage: "Webhook processing failed",
      fallbackCode: "WEBHOOK_ERROR",
    });
  }
}
