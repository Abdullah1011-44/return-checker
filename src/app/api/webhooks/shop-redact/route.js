import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  readVerifiedShopifyWebhook,
  resolveShopDomain,
} from "@/lib/shopifyComplianceWebhook";

/**
 * Shopify-required privacy webhook: shop/redact
 *
 * Sent after a shop uninstalls and Shopify requests app data redaction.
 * Marks the merchant inactive without deleting records or return history.
 */
export async function POST(request) {
  try {
    const verified = await readVerifiedShopifyWebhook(request);

    if (!verified.ok) {
      return verified.response;
    }

    const { headers, payload } = verified;
    const shopDomain = resolveShopDomain(headers, payload);

    if (shopDomain) {
      console.log("[shopify-compliance-webhook] shop domain:", shopDomain);

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

        console.log(
          "[shopify-compliance-webhook] merchant marked inactive:",
          merchant.id
        );
      } else {
        console.log(
          "[shopify-compliance-webhook] no merchant found for shop:",
          shopDomain
        );
      }
    }

    return NextResponse.json({
      success: true,
      topic: "shop/redact",
    });
  } catch (error) {
    console.error("[webhook shop/redact]", error);
    return NextResponse.json(
      { success: false, message: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
