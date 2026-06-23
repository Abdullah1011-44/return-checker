import { NextResponse } from "next/server";
import { AUDIT_EVENTS } from "@/lib/audit";
import {
  buildOrderStatusFields,
  getOrderStatusFieldUpdates,
} from "@/lib/orderStatusMapper";
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

const ROUTE_NAME = "webhooks/orders-updated";

function normalizeOrderNumber(order) {
  if (order?.name) {
    return String(order.name).replace(/^#/, "").trim();
  }

  if (order?.order_number != null) {
    return String(order.order_number);
  }

  if (order?.id != null) {
    return String(order.id);
  }

  return null;
}

function extractSafeOrderIdentifiers(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const shopifyOrderId = payload.id != null ? String(payload.id) : null;
  const orderNumber = normalizeOrderNumber(payload);

  if (!shopifyOrderId && !orderNumber) {
    return null;
  }

  return { shopifyOrderId, orderNumber };
}

function getSafeOrderUpdateFields(existingOrder, payload) {
  const patch = {
    ...(getOrderStatusFieldUpdates(existingOrder, payload) ?? {}),
  };

  if (payload.total_price != null) {
    const nextTotal = String(payload.total_price);
    if (String(existingOrder.totalAmount) !== nextTotal) {
      patch.totalAmount = nextTotal;
    }
  }

  if (payload.currency && existingOrder.currency !== payload.currency) {
    patch.currency = payload.currency;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

async function findMerchantOrder(merchantId, { shopifyOrderId, orderNumber }) {
  if (shopifyOrderId) {
    const orderByShopifyId = await prisma.customerOrder.findUnique({
      where: {
        merchantId_shopifyOrderId: {
          merchantId,
          shopifyOrderId,
        },
      },
    });

    if (orderByShopifyId) {
      return orderByShopifyId;
    }
  }

  if (orderNumber) {
    return prisma.customerOrder.findUnique({
      where: {
        merchantId_orderNumber: {
          merchantId,
          orderNumber,
        },
      },
    });
  }

  return null;
}

/**
 * Shopify orders/updated webhook.
 * Updates safe CustomerOrder fields only; never creates orders or touches return data.
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

    const identifiers = extractSafeOrderIdentifiers(parsed.data);
    if (!identifiers) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const existingOrder = await findMerchantOrder(merchant.id, identifiers);

    if (!existingOrder) {
      await createWebhookAuditLog({
        merchantId: merchant.id,
        action: AUDIT_EVENTS.ORDER_UPDATED_WEBHOOK_IGNORED,
        metadata: {
          shopDomain,
          shopifyOrderId: identifiers.shopifyOrderId,
          orderNumber: identifiers.orderNumber,
          source: "shopify_webhook",
        },
      });

      return NextResponse.json({ success: true, ignored: true });
    }

    const updateFields = getSafeOrderUpdateFields(existingOrder, parsed.data);
    const statusFields = buildOrderStatusFields(parsed.data);

    if (updateFields) {
      await prisma.customerOrder.update({
        where: { id: existingOrder.id },
        data: updateFields,
      });
    }

    await createWebhookAuditLog({
      merchantId: merchant.id,
      action: AUDIT_EVENTS.ORDER_UPDATED_WEBHOOK,
      metadata: {
        shopDomain,
        shopifyOrderId: identifiers.shopifyOrderId ?? existingOrder.shopifyOrderId,
        orderNumber: identifiers.orderNumber ?? existingOrder.orderNumber,
        status: statusFields.status,
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
      action: "webhook_orders_updated",
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
  extractSafeOrderIdentifiers,
  findMerchantOrder,
  getSafeOrderUpdateFields,
  normalizeOrderNumber,
};
