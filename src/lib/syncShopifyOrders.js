import { prisma } from "@/lib/prisma";
import {
  parseShopifyNextEndpoint,
  shopifyAdminRequest,
} from "@/lib/shopifyAdmin";

const ORDERS_PAGE_LIMIT = 50;
const MAX_ORDER_PAGES = 20;
const INITIAL_ORDERS_ENDPOINT = `/orders.json?status=any&limit=${ORDERS_PAGE_LIMIT}`;

/**
 * Map Shopify order status to Prisma OrderStatus.
 * Schema supports PENDING, PAID, FULFILLED, DELIVERED, CANCELLED only —
 * refunded/partially_refunded map to PAID with a note in code.
 */
export function mapShopifyOrderStatus(order) {
  if (order.cancelled_at) {
    return "CANCELLED";
  }

  // No REFUNDED / PARTIALLY_REFUNDED enum — treat as PAID (financially settled).
  if (
    order.financial_status === "refunded" ||
    order.financial_status === "partially_refunded"
  ) {
    return "PAID";
  }

  if (order.fulfillment_status === "fulfilled") {
    return "DELIVERED";
  }

  if (order.financial_status === "paid") {
    return "PAID";
  }

  if (order.financial_status === "pending") {
    return "PENDING";
  }

  return "PAID";
}

/**
 * Use fulfillment timestamp only — not order.updated_at (changes on any edit).
 */
export function mapShopifyDeliveredAt(order) {
  if (order.fulfillment_status !== "fulfilled") {
    return null;
  }

  const fulfillment = order.fulfillments?.[0];
  if (!fulfillment) {
    return null;
  }

  const deliveredAt = fulfillment.updated_at || fulfillment.created_at;
  return deliveredAt ? new Date(deliveredAt) : null;
}

function normalizeOrderNumber(order) {
  if (order.name) {
    return String(order.name).replace(/^#/, "").trim();
  }

  if (order.order_number != null) {
    return String(order.order_number);
  }

  return String(order.id);
}

function resolveCustomerEmail(order) {
  return (
    order.email?.trim().toLowerCase() ||
    order.customer?.email?.trim().toLowerCase() ||
    ""
  );
}

function resolveCustomerName(order) {
  const customer = order.customer;
  if (customer?.first_name || customer?.last_name) {
    return [customer.first_name, customer.last_name].filter(Boolean).join(" ");
  }

  if (order.shipping_address?.name) {
    return order.shipping_address.name;
  }

  return "Shopify Customer";
}

function mapLineItemSku(lineItem) {
  if (lineItem.sku) {
    return lineItem.sku;
  }

  if (lineItem.product_id != null) {
    return String(lineItem.product_id);
  }

  return String(lineItem.id);
}

async function testShopifyConnection(shopDomain, accessToken) {
  try {
    await shopifyAdminRequest(shopDomain, accessToken, "/shop.json");
  } catch {
    throw new Error("Shopify connection test failed");
  }
}

async function fetchAllShopifyOrders(shopDomain, accessToken) {
  const orders = [];
  let endpoint = INITIAL_ORDERS_ENDPOINT;
  let pagesFetched = 0;

  while (endpoint && pagesFetched < MAX_ORDER_PAGES) {
    const { data, headers } = await shopifyAdminRequest(
      shopDomain,
      accessToken,
      endpoint
    );

    const pageOrders = Array.isArray(data?.orders) ? data.orders : [];
    orders.push(...pageOrders);
    pagesFetched += 1;

    endpoint = parseShopifyNextEndpoint(headers.get("Link"));
  }

  return { orders, pagesFetched };
}

function buildCustomerOrderData(order, merchant) {
  return {
    orderNumber: normalizeOrderNumber(order),
    customerEmail: resolveCustomerEmail(order),
    customerName: resolveCustomerName(order),
    totalAmount: order.total_price ?? "0",
    status: mapShopifyOrderStatus(order),
    deliveredAt: mapShopifyDeliveredAt(order),
    currency: order.currency || merchant.currency || "USD",
    customerPhone: order.phone || order.customer?.phone || null,
    orderedAt: order.created_at ? new Date(order.created_at) : new Date(),
    shippingAmount: order.total_shipping_price_set?.shop_money?.amount ?? null,
  };
}

function buildOrderItemData(lineItem) {
  return {
    shopifyLineItemId: String(lineItem.id),
    productName:
      lineItem.title || lineItem.name || "Untitled item",
    sku: mapLineItemSku(lineItem),
    quantity: lineItem.quantity ?? 1,
    price: lineItem.price ?? "0",
    isReturnable: true,
    shopifyVariantId:
      lineItem.variant_id != null ? String(lineItem.variant_id) : null,
    variantName: lineItem.variant_title || null,
  };
}

/**
 * Sync Shopify orders for a merchant into CustomerOrder / OrderItem.
 * Safe to run multiple times — upserts by shopifyOrderId / shopifyLineItemId.
 *
 * Requires Shopify OAuth scope: read_orders.
 * If scope was added after install, merchant must reinstall the app.
 */
export async function syncShopifyOrders(merchantId) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      shopDomain: true,
      shopifyAccessToken: true,
      isActive: true,
      currency: true,
    },
  });

  if (!merchant) {
    throw new Error("Merchant not found");
  }

  if (!merchant.isActive) {
    throw new Error("Merchant is not active");
  }

  if (!merchant.shopDomain) {
    throw new Error("Merchant missing shop domain");
  }

  if (!merchant.shopifyAccessToken) {
    throw new Error("Merchant missing Shopify access token");
  }

  console.log("[Shopify Sync Debug]", {
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    hasToken: Boolean(merchant.shopifyAccessToken),
  });

  await testShopifyConnection(
    merchant.shopDomain,
    merchant.shopifyAccessToken
  );

  const { orders: shopifyOrders, pagesFetched } = await fetchAllShopifyOrders(
    merchant.shopDomain,
    merchant.shopifyAccessToken
  );

  const counts = {
    orders: { created: 0, updated: 0, totalSynced: 0 },
    items: { created: 0, updated: 0, totalSynced: 0 },
    pagesFetched,
  };

  for (const shopifyOrder of shopifyOrders) {
    const shopifyOrderId = String(shopifyOrder.id);
    const orderFields = buildCustomerOrderData(shopifyOrder, merchant);

    const existingOrder = await prisma.customerOrder.findUnique({
      where: {
        merchantId_shopifyOrderId: {
          merchantId: merchant.id,
          shopifyOrderId,
        },
      },
    });

    let customerOrder;

    if (existingOrder) {
      customerOrder = await prisma.customerOrder.update({
        where: { id: existingOrder.id },
        data: orderFields,
      });
      counts.orders.updated += 1;
    } else {
      customerOrder = await prisma.customerOrder.create({
        data: {
          merchantId: merchant.id,
          shopifyOrderId,
          ...orderFields,
        },
      });
      counts.orders.created += 1;
    }

    counts.orders.totalSynced += 1;

    const lineItems = Array.isArray(shopifyOrder.line_items)
      ? shopifyOrder.line_items
      : [];

    for (const lineItem of lineItems) {
      const shopifyLineItemId = String(lineItem.id);
      const itemFields = buildOrderItemData(lineItem);

      const existingItem = await prisma.orderItem.findUnique({
        where: {
          orderId_shopifyLineItemId: {
            orderId: customerOrder.id,
            shopifyLineItemId,
          },
        },
      });

      if (existingItem) {
        await prisma.orderItem.update({
          where: { id: existingItem.id },
          data: itemFields,
        });
        counts.items.updated += 1;
      } else {
        await prisma.orderItem.create({
          data: {
            orderId: customerOrder.id,
            ...itemFields,
          },
        });
        counts.items.created += 1;
      }

      counts.items.totalSynced += 1;
    }
  }

  return {
    success: true,
    orders: counts.orders,
    items: counts.items,
    pagesFetched: counts.pagesFetched,
  };
}
