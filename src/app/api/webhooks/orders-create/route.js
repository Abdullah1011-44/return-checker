import { NextResponse } from "next/server";
import { AUDIT_EVENTS } from "@/lib/audit";
import { buildOrderStatusFields, getOrderStatusFieldUpdates } from "@/lib/orderStatusMapper";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import { logWebhookInvalidHmac } from "@/lib/shopifyComplianceWebhook";
import { getShopifyWebhookHeaders } from "@/lib/shopifyWebhook";
import {
  createWebhookAuditLog,
  getWebhookMerchant,
  parseWebhookJson,
  readRawBody,
  verifyIncomingShopifyWebhook,
} from "@/lib/shopifyWebhookHandlers";

const ROUTE_NAME = "webhooks/orders-create";

function normalizeOrderNumber(order) {
  if (order.name) {
    return String(order.name).replace(/^#/, "").trim();
  }

  if (order.order_number != null) {
    return String(order.order_number);
  }

  if (order.id != null) {
    return String(order.id);
  }

  return null;
}

function resolvePlaceholderCustomerEmail(shopifyOrderId) {
  return `shopify-order-${shopifyOrderId}@placeholder.returnradar.local`;
}

function resolvePlaceholderCustomerName() {
  return "Shopify Customer";
}

/**
 * Extract only non-PII order fields supported by CustomerOrder.
 * Never reads email, phone, address, or customer object from payload.
 */
function extractSafeShopifyOrderFields(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const shopifyOrderId = payload.id != null ? String(payload.id) : null;
  const orderNumber = normalizeOrderNumber(payload);

  if (!shopifyOrderId || !orderNumber) {
    return null;
  }

  return {
    shopifyOrderId,
    orderNumber,
    totalPrice: payload.total_price ?? "0",
    currency: payload.currency ?? "USD",
    orderedAt: payload.created_at ? new Date(payload.created_at) : new Date(),
    ...buildOrderStatusFields({
      financial_status: payload.financial_status ?? null,
      fulfillment_status: payload.fulfillment_status ?? null,
      cancelled_at: payload.cancelled_at ?? null,
    }),
  };
}

/**
 * Shopify orders/create webhook.
 * Creates a local CustomerOrder when missing; updates status fields only when present.
 */
export async function POST(request) {
  const webhookMeta = { route: ROUTE_NAME };

  try {
    const rawBody = await readRawBody(request);
    const verification = verifyIncomingShopifyWebhook(request, rawBody);

    if (!verification.valid) {
      await logWebhookInvalidHmac(
        ROUTE_NAME,
        getShopifyWebhookHeaders(request),
        request
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shopDomain = verification.shopDomain;
    webhookMeta.shopDomain = shopDomain;

    const merchant = await getWebhookMerchant(shopDomain);
    if (!merchant) {
      console.log("[Shopify Webhook]", {
        route: ROUTE_NAME,
        shopDomain,
        ignored: true,
        reason: "Unknown or inactive merchant",
      });
      return NextResponse.json({ success: true, ignored: true });
    }

    webhookMeta.merchantId = merchant.id;

    const parsed = parseWebhookJson(rawBody);
    if (!parsed.success || !parsed.data) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const safeOrder = extractSafeShopifyOrderFields(parsed.data);
    if (!safeOrder) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const existingOrder = await prisma.customerOrder.findUnique({
      where: {
        merchantId_shopifyOrderId: {
          merchantId: merchant.id,
          shopifyOrderId: safeOrder.shopifyOrderId,
        },
      },
    });

    if (existingOrder) {
      const statusUpdates = getOrderStatusFieldUpdates(existingOrder, parsed.data);

      if (statusUpdates) {
        await prisma.customerOrder.update({
          where: { id: existingOrder.id },
          data: statusUpdates,
        });
      }

      return NextResponse.json({ success: true });
    }

    await prisma.customerOrder.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: safeOrder.shopifyOrderId,
        orderNumber: safeOrder.orderNumber,
        totalAmount: safeOrder.totalPrice,
        currency: safeOrder.currency,
        status: safeOrder.status,
        financialStatus: safeOrder.financialStatus,
        fulfillmentStatus: safeOrder.fulfillmentStatus,
        cancelledAt: safeOrder.cancelledAt,
        orderedAt: safeOrder.orderedAt,
        customerEmail: resolvePlaceholderCustomerEmail(safeOrder.shopifyOrderId),
        customerName: resolvePlaceholderCustomerName(),
        customerPhone: null,
      },
    });

    await createWebhookAuditLog({
      merchantId: merchant.id,
      action: AUDIT_EVENTS.ORDER_CREATED_WEBHOOK,
      metadata: {
        shopDomain,
        shopifyOrderId: safeOrder.shopifyOrderId,
        orderNumber: safeOrder.orderNumber,
        source: "shopify_webhook",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: webhookMeta.merchantId || null,
      shopDomain: webhookMeta.shopDomain || null,
      action: "webhook_orders_create",
    });

    console.error("[Shopify Webhook]", {
      route: ROUTE_NAME,
      shopDomain: webhookMeta.shopDomain ?? null,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json({ success: false }, { status: 500 });
  }
}

export {
  extractSafeShopifyOrderFields,
  normalizeOrderNumber,
};
