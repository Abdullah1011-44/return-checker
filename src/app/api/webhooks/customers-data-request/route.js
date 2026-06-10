import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import {
  logCustomerFromPayload,
  readVerifiedShopifyWebhook,
  resolveShopDomain,
} from "@/lib/shopifyComplianceWebhook";

/**
 * Shopify-required privacy webhook: customers/data_request
 *
 * A customer has requested their stored data. Acknowledge the request;
 * do not delete or export data in this MVP handler.
 */
export async function POST(request) {
  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: "webhook-customers-data-request",
      limit: 100,
      windowMs: 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult);
    }

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
      topic: "customers/data_request",
    });
  } catch (error) {
    console.error("[webhook customers/data_request]", error);
    return NextResponse.json(
      { success: false, message: "Webhook processing failed." },
      { status: 500 }
    );
  }
}
