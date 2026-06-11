import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import {
  handleWebhookRouteError,
  logWebhookReceived,
  readVerifiedShopifyWebhook,
  resolveShopDomain,
} from "@/lib/shopifyComplianceWebhook";

const ROUTE_NAME = "webhook-shop-redact";

/**
 * Shopify-required privacy webhook: shop/redact
 *
 * Sent after a shop uninstalls and Shopify requests app data redaction.
 * Marks the merchant inactive without deleting records or return history.
 */
export async function POST(request) {
  const webhookMeta = { topic: "shop/redact" };

  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: ROUTE_NAME,
      limit: 100,
      windowMs: 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult);
    }

    logWebhookReceived(ROUTE_NAME, request);

    const verified = await readVerifiedShopifyWebhook(request, ROUTE_NAME);

    if (!verified.ok) {
      return verified.response;
    }

    const { headers, payload } = verified;
    const shopDomain = resolveShopDomain(headers, payload);

    webhookMeta.topic = headers.topic ?? webhookMeta.topic;
    webhookMeta.shopDomain = shopDomain;

    if (shopDomain) {
      const merchant = await prisma.merchant.findUnique({
        where: { shopDomain },
      });

      if (merchant) {
        await prisma.merchant.update({
          where: { id: merchant.id },
          data: {
            isActive: false,
            shopifyUninstalledAt: new Date(),
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      topic: "shop/redact",
    });
  } catch (error) {
    return handleWebhookRouteError(ROUTE_NAME, error, webhookMeta);
  }
}
