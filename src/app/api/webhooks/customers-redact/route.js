import { NextResponse } from "next/server";
import {
  logCustomerFromPayload,
  readVerifiedShopifyWebhook,
  resolveShopDomain,
} from "@/lib/shopifyComplianceWebhook";

/**
 * Shopify-required privacy webhook: customers/redact
 *
 * Shopify requests deletion/redaction of customer data. For MVP we log and
 * acknowledge only — no blind deletes until a defined retention policy exists.
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
    }

    logCustomerFromPayload(payload);

    return NextResponse.json({
      success: true,
      topic: "customers/redact",
    });
  } catch (error) {
    console.error("[webhook customers/redact]", error);
    return NextResponse.json(
      { success: false, message: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
