/**
 * Map Shopify order fields to CustomerOrder status columns.
 */

/**
 * @param {object} order
 */
export function mapShopifyOrderStatus(order) {
  if (order.cancelled_at) {
    return "CANCELLED";
  }

  if (order.fulfillment_status === "fulfilled") {
    return "FULFILLED";
  }

  if (order.financial_status === "paid") {
    return "PAID";
  }

  return "PENDING";
}

/**
 * @param {object} order
 * @returns {string | null}
 */
export function mapShopifyFinancialStatus(order) {
  return order.financial_status ?? null;
}

/**
 * @param {object} order
 * @returns {string | null}
 */
export function mapShopifyFulfillmentStatus(order) {
  return order.fulfillment_status ?? null;
}

/**
 * @param {object} order
 * @returns {Date | null}
 */
export function mapShopifyCancelledAt(order) {
  return order.cancelled_at ? new Date(order.cancelled_at) : null;
}

/**
 * @param {object} shopifyOrder
 */
export function buildOrderStatusFields(shopifyOrder) {
  return {
    status: mapShopifyOrderStatus(shopifyOrder),
    financialStatus: mapShopifyFinancialStatus(shopifyOrder),
    fulfillmentStatus: mapShopifyFulfillmentStatus(shopifyOrder),
    cancelledAt: mapShopifyCancelledAt(shopifyOrder),
  };
}

function datesEqual(left, right) {
  if (left == null && right == null) {
    return true;
  }

  if (left == null || right == null) {
    return false;
  }

  return new Date(left).getTime() === new Date(right).getTime();
}

/**
 * Build a partial update for status-related fields, or null when nothing changed.
 *
 * @param {{
 *   status: string;
 *   financialStatus: string | null;
 *   fulfillmentStatus: string | null;
 *   cancelledAt: Date | null;
 * }} existingOrder
 * @param {object} shopifyOrder
 */
export function getOrderStatusFieldUpdates(existingOrder, shopifyOrder) {
  const next = buildOrderStatusFields(shopifyOrder);
  const patch = {};

  if (existingOrder.status !== next.status) {
    patch.status = next.status;
  }

  if (existingOrder.financialStatus !== next.financialStatus) {
    patch.financialStatus = next.financialStatus;
  }

  if (existingOrder.fulfillmentStatus !== next.fulfillmentStatus) {
    patch.fulfillmentStatus = next.fulfillmentStatus;
  }

  if (!datesEqual(existingOrder.cancelledAt, next.cancelledAt)) {
    patch.cancelledAt = next.cancelledAt;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
