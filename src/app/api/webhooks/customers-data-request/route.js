import { NextResponse } from "next/server";
import {
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
} from "@/lib/adminAudit";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { captureException } from "@/lib/sentry";
import {
  handleWebhookRouteError,
  logCustomerFromPayload,
  logWebhookReceived,
  persistComplianceWebhookSuccess,
  readVerifiedShopifyWebhook,
  resolveShopDomain,
} from "@/lib/shopifyComplianceWebhook";

const ROUTE_NAME = "webhook-customers-data-request";

/**
 * Shopify-required privacy webhook: customers/data_request
 *
 * A customer has requested their stored data. Acknowledge the request;
 * do not delete or export data in this MVP handler.
 */
export async function POST(request) {
  const webhookMeta = { topic: "customers/data_request" };

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

    logCustomerFromPayload(payload);

    await persistComplianceWebhookSuccess({
      request,
      routeName: ROUTE_NAME,
      headers,
      shopDomain,
      eventType: ADMIN_AUDIT_EVENTS.CUSTOMERS_DATA_REQUEST,
      severity: ADMIN_AUDIT_SEVERITY.INFO,
      message: "Shopify customers data request received",
    });

    return NextResponse.json({
      success: true,
      topic: "customers/data_request",
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: null,
      shopDomain: webhookMeta.shopDomain || null,
      action: "webhook_customers_data_request",
    });

    return handleWebhookRouteError(ROUTE_NAME, error, webhookMeta);
  }
}
