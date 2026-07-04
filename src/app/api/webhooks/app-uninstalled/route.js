import { NextResponse } from "next/server";
import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
  getAuditRequestContext,
  safeCreateAdminAuditLog,
  sanitizeAdminAuditMetadata,
} from "@/lib/adminAudit";
import { AUDIT_ACTORS, AUDIT_EVENTS, logAuditInfo } from "@/lib/audit";
import {
  createApiErrorResponse,
  handleApiError,
  logSafeError,
} from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { captureException } from "@/lib/sentry";
import {
  logWebhookInvalidHmac,
  logWebhookReceived,
} from "@/lib/shopifyComplianceWebhook";
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

    await logWebhookReceived(ROUTE_NAME, request);

    const rawBody = await request.text();
    const headers = getShopifyWebhookHeaders(request);
    const hmacCheck = verifyShopifyWebhookHmac(rawBody, headers.hmac);

    if (!hmacCheck.valid) {
      await logWebhookInvalidHmac(ROUTE_NAME, headers, request);
      return createApiErrorResponse(
        "Unauthorized",
        401,
        "INVALID_WEBHOOK_HMAC",
      );
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

    let merchantMarkedInactive = false;
    let merchantId = null;

    if (shopDomain) {
      const merchant = await prisma.merchant.findUnique({
        where: { shopDomain },
      });

      if (merchant) {
        merchantId = merchant.id;
        webhookMeta.merchantId = merchantId;

        await prisma.merchant.update({
          where: { id: merchant.id },
          data: {
            isActive: false,
            shopifyAccessToken: null,
            shopifyUninstalledAt: new Date(),
          },
        });

        merchantMarkedInactive = true;
      }
    }

    logAuditInfo(
      AUDIT_EVENTS.APP_UNINSTALLED,
      sanitizeAdminAuditMetadata({
        actorType: AUDIT_ACTORS.WEBHOOK,
        shopDomain,
        merchantUpdated: merchantMarkedInactive,
      }),
    );

    await safeCreateAdminAuditLog({
      ...(merchantId ? { merchantId } : {}),
      eventType: ADMIN_AUDIT_EVENTS.APP_UNINSTALLED,
      actorType: ADMIN_AUDIT_ACTORS.WEBHOOK,
      severity: ADMIN_AUDIT_SEVERITY.WARN,
      resourceType: "SHOPIFY_APP",
      message: "Shopify app uninstalled",
      metadata: sanitizeAdminAuditMetadata({
        shopDomain,
        merchantUpdated: merchantMarkedInactive,
      }),
      ...getAuditRequestContext(request),
    });

    return NextResponse.json({
      success: true,
      topic: "app/uninstalled",
    });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: webhookMeta.merchantId || null,
      shopDomain: webhookMeta.shopDomain || null,
      action: "webhook_app_uninstalled",
    });

    logWebhookError(error, webhookMeta);

    return handleApiError(error, {
      context: ROUTE_NAME,
      fallbackMessage: "Webhook processing failed",
      fallbackCode: "WEBHOOK_ERROR",
    });
  }
}
