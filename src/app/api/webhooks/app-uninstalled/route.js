import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import {
  getShopifyWebhookHeaders,
  verifyShopifyWebhookHmac,
} from "@/lib/shopifyWebhook";

/**
 * Shopify app lifecycle webhook: app/uninstalled
 *
 * Fired when a merchant uninstalls the app. Marks the merchant inactive
 * without deleting records, return history, or exposing access tokens.
 */
export async function POST(request) {
  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: "webhook-app-uninstalled",
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
      return NextResponse.json(
        { success: false, message: "Invalid webhook HMAC" },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody);

    const shopDomain =
      headers.shopDomain ||
      payload.myshopify_domain ||
      payload.shop_domain ||
      payload.domain ||
      null;

    console.log("[shopify-app-uninstalled]", {
      topic: headers.topic ?? "app/uninstalled",
      shopDomain,
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
    console.error("[webhook app/uninstalled]", error);
    return NextResponse.json(
      { success: false, message: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
