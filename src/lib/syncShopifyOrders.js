import { logOrderStatusUpdated } from "@/lib/adminAudit";
import {
  buildOrderStatusFields,
  getOrderStatusFieldUpdates,
} from "@/lib/orderStatusMapper";
import { prisma } from "@/lib/prisma";
import {
  parseShopifyNextEndpoint,
  shopifyAdminRequest,
} from "@/lib/shopifyAdmin";

const ORDERS_PAGE_LIMIT = 50;
const MAX_ORDER_PAGES = 20;
// Minimal order fields only — avoids Protected Customer Data (email, name, phone, addresses).
// Real customer email/name can be enabled after Shopify approves protected customer data access.
const ORDER_FIELDS =
  "id,name,order_number,total_price,currency,financial_status,fulfillment_status,cancelled_at,created_at,fulfillments,line_items,total_shipping_price_set";
const INITIAL_ORDERS_ENDPOINT = `/orders.json?status=any&limit=${ORDERS_PAGE_LIMIT}&fields=${ORDER_FIELDS}`;

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

// This placeholder avoids Protected Customer Data access during development.
// Real customer email/name can be enabled after Shopify approves protected customer data access.
function resolveCustomerEmail(order) {
  return `shopify-order-${order.id}@placeholder.returnradar.local`;
}

function resolveCustomerName(order) {
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
  await shopifyAdminRequest(shopDomain, accessToken, "/shop.json");
}

async function fetchAllShopifyOrders(shopDomain, accessToken) {
  const orders = [];
  let endpoint = INITIAL_ORDERS_ENDPOINT;
  let pagesFetched = 0;

  while (endpoint && pagesFetched < MAX_ORDER_PAGES) {
    const { data, headers } = await shopifyAdminRequest(
      shopDomain,
      accessToken,
      endpoint,
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
    ...buildOrderStatusFields(order),
    deliveredAt: mapShopifyDeliveredAt(order),
    currency: order.currency || merchant.currency || "USD",
    customerPhone: null,
    orderedAt: order.created_at ? new Date(order.created_at) : new Date(),
    shippingAmount: order.total_shipping_price_set?.shop_money?.amount ?? null,
  };
}

function buildOrderItemData(lineItem) {
  return {
    shopifyLineItemId: String(lineItem.id),
    productName: lineItem.title || lineItem.name || "Untitled item",
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
 * Load safe audit context for Shopify sync (same DB row the API uses for tokens).
 * Never returns the actual access token — only hasToken boolean.
 */
export async function getMerchantSyncAuditContext(merchantId) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      shopDomain: true,
      shopifyAccessToken: true,
    },
  });

  if (!merchant) {
    return {
      merchantId,
      shopDomain: null,
      hasToken: false,
    };
  }

  return {
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
    hasToken: Boolean(merchant.shopifyAccessToken),
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

  await testShopifyConnection(merchant.shopDomain, merchant.shopifyAccessToken);

  const { orders: shopifyOrders, pagesFetched } = await fetchAllShopifyOrders(
    merchant.shopDomain,
    merchant.shopifyAccessToken,
  );

  const counts = {
    orders: { created: 0, updated: 0, skipped: 0 },
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
      const statusUpdates = getOrderStatusFieldUpdates(
        existingOrder,
        shopifyOrder,
      );

      if (statusUpdates) {
        customerOrder = await prisma.customerOrder.update({
          where: { id: existingOrder.id },
          data: statusUpdates,
        });
        counts.orders.updated += 1;

        if (statusUpdates.status) {
          await logOrderStatusUpdated({
            merchantId: merchant.id,
            orderId: existingOrder.id,
            oldStatus: existingOrder.status,
            newStatus: statusUpdates.status,
          });
        }
      } else {
        customerOrder = existingOrder;
        counts.orders.skipped += 1;
      }
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

/**
 * Sync Shopify orders (and embedded order status fields) for a merchant record.
 *
 * @param {{ id: string }} merchant
 */
export async function syncShopifyOrdersForMerchant(merchant) {
  if (!merchant?.id) {
    throw new Error("Merchant id is required for order sync");
  }

  return syncShopifyOrders(merchant.id);
}

/**
 * Order status fields are updated during {@link syncShopifyOrders} /
 * {@link syncShopifyOrdersForMerchant}. Extract a safe summary from that result.
 *
 * @param {Awaited<ReturnType<typeof syncShopifyOrders>> | null | undefined} orderSyncResult
 */
export function summarizeOrderStatusSyncFromOrders(orderSyncResult) {
  return {
    updated: orderSyncResult?.orders?.updated ?? 0,
    skipped: orderSyncResult?.orders?.skipped ?? 0,
  };
}
