import { getCurrentMerchant } from "@/lib/auth";
import {
  applyDuplicateFlagsToCheckItem,
  duplicateItemsToMap,
  findDuplicateReturnItems,
} from "@/lib/duplicateReturnPrevention";
import { prisma } from "@/lib/prisma";
import { normalizeEmail, normalizeOrderNumber } from "@/lib/returnApiMappers";

/** Shared merchant resolution for customer portal APIs. */
export async function resolveMerchantForCustomerFlow() {
  return getCurrentMerchant();
}

/**
 * Find CustomerOrder for return check/submit.
 * When merchant session exists, scopes to merchant.id (no cross-merchant leakage).
 */
export async function findCustomerOrderForReturn({
  orderNumber,
  email,
  merchant = null,
}) {
  const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
  const normalizedEmail = normalizeEmail(email);

  return prisma.customerOrder.findFirst({
    where: {
      orderNumber: normalizedOrderNumber,
      customerEmail: normalizedEmail,
      ...(merchant ? { merchantId: merchant.id } : {}),
    },
    include: {
      items: true,
      merchant: true,
    },
  });
}

function itemReturnWindowExpired(order, merchant) {
  if (!order.deliveredAt || merchant?.returnWindowDays == null) {
    return false;
  }

  const expiresAt = new Date(order.deliveredAt);
  expiresAt.setDate(expiresAt.getDate() + merchant.returnWindowDays);
  return new Date() > expiresAt;
}

function mapOrderItemToCheckItem(orderItem, order, merchant) {
  let eligible = orderItem.isReturnable;
  let ineligibleReason = "";

  if (!orderItem.isReturnable) {
    eligible = false;
    ineligibleReason = "This item is not eligible for return.";
  } else if (itemReturnWindowExpired(order, merchant)) {
    eligible = false;
    ineligibleReason = `Return window has expired (${merchant.returnWindowDays} days).`;
  }

  return {
    id: orderItem.id,
    title: orderItem.productName,
    sku: orderItem.sku,
    quantity: orderItem.quantity,
    price: orderItem.price != null ? Number(orderItem.price) : 0,
    eligible,
    ineligibleReason,
    returnable: orderItem.isReturnable,
    finalSale: !orderItem.isReturnable,
    itemType: orderItem.isReturnable ? "standard" : "clearance",
  };
}

/** Map Prisma CustomerOrder → /api/check-return response shape. */
export async function buildOrderCheckApiResponse(order, prismaClient = prisma) {
  const orderItemIds = (order.items ?? []).map((item) => item.id);
  const duplicateItems = await findDuplicateReturnItems({
    prisma: prismaClient,
    merchantId: order.merchantId,
    orderItemIds,
  });
  const duplicateByOrderItemId = duplicateItemsToMap(duplicateItems);

  const items = (order.items ?? []).map((item) =>
    applyDuplicateFlagsToCheckItem(
      mapOrderItemToCheckItem(item, order, order.merchant),
      duplicateByOrderItemId.get(item.id),
    ),
  );
  const orderEligible = items.some((item) => item.eligible);

  return {
    success: true,
    orderFound: true,
    orderNumber: order.orderNumber,
    customerEmail: order.customerEmail,
    orderEligible,
    items,
  };
}

export function orderNotFoundMessage(merchant) {
  return merchant
    ? "Order not found for your store."
    : "Order not found. Please check your order number and email.";
}
