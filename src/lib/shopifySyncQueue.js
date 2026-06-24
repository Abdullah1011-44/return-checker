import { inngest } from "@/lib/inngest";

export const SHOPIFY_SYNC_REQUESTED_EVENT = "shopify/sync.requested";

/**
 * Build a safe Inngest event payload. Never include tokens, customer data, or
 * raw Shopify payloads.
 *
 * @param {{ merchantId: string, reason?: string }} params
 */
export function buildShopifySyncEventData({ merchantId, reason }) {
  if (!merchantId || typeof merchantId !== "string") {
    throw new Error("Invalid merchantId for sync queue");
  }

  return {
    merchantId,
    reason:
      typeof reason === "string" && reason.trim() ? reason.trim() : "queue",
    requestedAt: new Date().toISOString(),
  };
}

/**
 * Queue a background Shopify sync for one merchant.
 * Internal/scheduler routes must load merchants from DB before calling this.
 *
 * @param {{ merchantId: string, reason?: string }} params
 */
export async function queueShopifySyncForMerchant({ merchantId, reason }) {
  const data = buildShopifySyncEventData({ merchantId, reason });

  await inngest.send({
    name: SHOPIFY_SYNC_REQUESTED_EVENT,
    data,
  });

  return {
    queued: true,
    merchantId: data.merchantId,
    reason: data.reason,
    requestedAt: data.requestedAt,
  };
}
