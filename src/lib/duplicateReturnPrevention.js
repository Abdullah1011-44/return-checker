/**
 * Prevent duplicate return submissions for the same OrderItem while an active
 * ReturnRequest exists. Merchant-scoped for data isolation.
 *
 * Prisma ReturnStatus uses IN_REVIEW for in-progress merchant review flows
 * (including NEEDS_MORE_INFO at the ReturnItem level). REJECTED requests
 * do not block a new submission.
 */

export const DUPLICATE_BLOCKING_RETURN_STATUSES = [
  "PENDING",
  "IN_REVIEW",
  "APPROVED",
  "RESOLVED",
];

export const DUPLICATE_RETURN_MESSAGE =
  "Return already requested for this item";

export class DuplicateReturnRequestError extends Error {
  constructor(duplicateItems) {
    super("One or more selected items already have an active return request.");
    this.name = "DuplicateReturnRequestError";
    this.code = "DUPLICATE_RETURN_REQUEST";
    this.duplicateItems = duplicateItems;
  }
}

/**
 * @param {string[]} orderItemIds
 * @returns {boolean}
 */
export function hasDuplicateOrderItemIds(orderItemIds) {
  const ids = (orderItemIds ?? []).filter(Boolean);
  return new Set(ids).size !== ids.length;
}

/**
 * Find order items that already belong to an active return request for this merchant.
 *
 * @param {{
 *   prisma: import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient;
 *   merchantId: string;
 *   orderItemIds: string[];
 * }} params
 */
export async function findDuplicateReturnItems({
  prisma,
  merchantId,
  orderItemIds,
}) {
  if (
    !merchantId ||
    !Array.isArray(orderItemIds) ||
    orderItemIds.length === 0
  ) {
    return [];
  }

  const uniqueOrderItemIds = [...new Set(orderItemIds.filter(Boolean))];
  if (uniqueOrderItemIds.length === 0) {
    return [];
  }

  const existingItems = await prisma.returnItem.findMany({
    where: {
      orderItemId: { in: uniqueOrderItemIds },
      returnRequest: {
        merchantId,
        status: { in: DUPLICATE_BLOCKING_RETURN_STATUSES },
      },
    },
    select: {
      orderItemId: true,
      merchantDecision: true,
      returnRequest: {
        select: {
          id: true,
          status: true,
        },
      },
      orderItem: {
        select: {
          id: true,
          productName: true,
          sku: true,
        },
      },
    },
  });

  return existingItems.map((item) => ({
    orderItemId: item.orderItemId,
    productName: item.orderItem?.productName ?? null,
    sku: item.orderItem?.sku ?? null,
    returnRequestId: item.returnRequest.id,
    existingReturnStatus: item.returnRequest.status,
    merchantDecision: item.merchantDecision,
  }));
}

/**
 * @param {Awaited<ReturnType<typeof findDuplicateReturnItems>>} duplicateItems
 */
export function formatDuplicateItemsForResponse(duplicateItems) {
  return duplicateItems.map((item) => ({
    orderItemId: item.orderItemId,
    title: item.productName,
    sku: item.sku,
    returnRequestId: item.returnRequestId,
    existingReturnStatus: item.existingReturnStatus,
    duplicateReturnMessage: DUPLICATE_RETURN_MESSAGE,
  }));
}

/**
 * @param {Awaited<ReturnType<typeof findDuplicateReturnItems>>} duplicateItems
 */
export function duplicateItemsToMap(duplicateItems) {
  return new Map(duplicateItems.map((item) => [item.orderItemId, item]));
}

/**
 * Apply duplicate return flags to a check-return item payload.
 *
 * @param {object} item
 * @param {Awaited<ReturnType<typeof findDuplicateReturnItems>>[number] | undefined} duplicate
 */
export function applyDuplicateFlagsToCheckItem(item, duplicate) {
  if (!duplicate) {
    return {
      ...item,
      alreadyReturnRequested: false,
    };
  }

  return {
    ...item,
    eligible: false,
    alreadyReturnRequested: true,
    existingReturnStatus: duplicate.existingReturnStatus,
    existingReturnRequestId: duplicate.returnRequestId,
    duplicateReturnMessage: DUPLICATE_RETURN_MESSAGE,
    ineligibleReason: DUPLICATE_RETURN_MESSAGE,
  };
}
