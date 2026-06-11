import { NextResponse } from "next/server";
import {
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
} from "@/lib/adminAudit";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { captureException } from "@/lib/sentry";
import {
  handleWebhookRouteError,
  logWebhookReceived,
  persistComplianceWebhookSuccess,
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

    await logWebhookReceived(ROUTE_NAME, request);

    const verified = await readVerifiedShopifyWebhook(request, ROUTE_NAME);

    if (!verified.ok) {
      return verified.response;
    }

    const { headers, payload } = verified;
    const shopDomain = resolveShopDomain(headers, payload);

    webhookMeta.topic = headers.topic ?? webhookMeta.topic;
    webhookMeta.shopDomain = shopDomain;

    let merchantId = null;

    if (shopDomain) {
      const merchant = await prisma.merchant.findUnique({
        where: { shopDomain },
      });

      if (merchant) {
        merchantId = merchant.id;

        await prisma.merchant.update({
          where: { id: merchant.id },
          data: {
            isActive: false,
            shopifyUninstalledAt: new Date(),
          },
        });
      }
    }

    await persistComplianceWebhookSuccess({
      request,
      routeName: ROUTE_NAME,
      headers,
      shopDomain,
      eventType: ADMIN_AUDIT_EVENTS.SHOP_REDACT,
      severity: ADMIN_AUDIT_SEVERITY.WARN,
      message: "Shopify shop redact request received",
      merchantId,
    });

    return NextResponse.json({
      success: true,
      topic: "shop/redact",
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: webhookMeta.merchantId || null,
      shopDomain: webhookMeta.shopDomain || null,
      action: "webhook_shop_redact",
    });

    return handleWebhookRouteError(ROUTE_NAME, error, webhookMeta);
  }
}
