import { NextResponse } from "next/server";
import { AUDIT_EVENTS } from "@/lib/audit";
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

const ROUTE_NAME = "webhooks/fulfillments-create";

/**
 * Extract only non-PII fulfillment identifiers needed to update an order.
 * Ignores tracking numbers, addresses, and line item details.
 */
function extractSafeFulfillmentFields(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.order_id == null) {
    return null;
  }

  return {
    shopifyOrderId: String(payload.order_id),
    fulfillmentStatus: payload.status ?? null,
    shipmentStatus: payload.shipment_status ?? null,
  };
}

function mapFulfillmentStatusForOrder(fulfillmentStatus) {
  const normalized = String(fulfillmentStatus ?? "").toLowerCase();

  if (normalized === "cancelled" || normalized === "error" || normalized === "failure") {
    return "unfulfilled";
  }

  return "fulfilled";
}

function mapOrderStatusFromFulfillment({ shipmentStatus, fulfillmentStatus }) {
  const shipment = String(shipmentStatus ?? "").toLowerCase();

  if (shipment === "delivered") {
    return "DELIVERED";
  }

  const mappedFulfillmentStatus = mapFulfillmentStatusForOrder(fulfillmentStatus);
  if (mappedFulfillmentStatus === "fulfilled") {
    return "FULFILLED";
  }

  return null;
}

function getFulfillmentOrderUpdateFields(existingOrder, fulfillmentFields) {
  const patch = {};
  const nextFulfillmentStatus = mapFulfillmentStatusForOrder(
    fulfillmentFields.fulfillmentStatus
  );

  if (existingOrder.fulfillmentStatus !== nextFulfillmentStatus) {
    patch.fulfillmentStatus = nextFulfillmentStatus;
  }

  if (existingOrder.status === "CANCELLED") {
    return Object.keys(patch).length > 0 ? patch : null;
  }

  const nextStatus = mapOrderStatusFromFulfillment(fulfillmentFields);
  if (nextStatus && existingOrder.status !== nextStatus) {
    patch.status = nextStatus;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

async function findMerchantOrderByShopifyId(merchantId, shopifyOrderId) {
  return prisma.customerOrder.findUnique({
    where: {
      merchantId_shopifyOrderId: {
        merchantId,
        shopifyOrderId,
      },
    },
  });
}

/**
 * Shopify fulfillments/create webhook.
 * Updates local order fulfillment/delivery status only.
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

    const fulfillmentFields = extractSafeFulfillmentFields(parsed.data);
    if (!fulfillmentFields) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    const existingOrder = await findMerchantOrderByShopifyId(
      merchant.id,
      fulfillmentFields.shopifyOrderId
    );

    if (!existingOrder) {
      console.log("[Shopify Webhook]", {
        route: ROUTE_NAME,
        shopDomain,
        shopifyOrderId: fulfillmentFields.shopifyOrderId,
        ignored: true,
        reason: "Order not found",
      });
      return NextResponse.json({ success: true, ignored: true });
    }

    const updateFields = getFulfillmentOrderUpdateFields(
      existingOrder,
      fulfillmentFields
    );

    if (updateFields) {
      await prisma.customerOrder.update({
        where: { id: existingOrder.id },
        data: updateFields,
      });
    }

    await createWebhookAuditLog({
      merchantId: merchant.id,
      action: AUDIT_EVENTS.FULFILLMENT_CREATED_WEBHOOK,
      metadata: {
        shopDomain,
        shopifyOrderId: fulfillmentFields.shopifyOrderId,
        fulfillmentStatus: mapFulfillmentStatusForOrder(
          fulfillmentFields.fulfillmentStatus
        ),
        shipmentStatus: fulfillmentFields.shipmentStatus,
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
      action: "webhook_fulfillments_create",
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
  extractSafeFulfillmentFields,
  getFulfillmentOrderUpdateFields,
  mapFulfillmentStatusForOrder,
  mapOrderStatusFromFulfillment,
};
