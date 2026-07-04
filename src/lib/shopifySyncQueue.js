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
 * @param {unknown} error
 */
export function classifyInngestQueueError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cause = error?.cause;
  const causePort =
    cause && typeof cause === "object" && "port" in cause ? cause.port : null;
  const causeCode =
    cause && typeof cause === "object" && "code" in cause ? cause.code : null;

  const isLocalInngestDevServer =
    message.includes("8288") ||
    causePort === 8288 ||
    (causeCode === "ECONNREFUSED" &&
      (message.includes("localhost") ||
        message.includes("127.0.0.1") ||
        message.includes("::1")));

  if (isLocalInngestDevServer) {
    const queueError = new Error(
      "Inngest dev server is not running on localhost:8288",
    );
    queueError.code = "INNGEST_QUEUE_UNAVAILABLE";
    queueError.status = 503;
    queueError.cause = error;
    return queueError;
  }

  const queueError = new Error("Failed to queue Shopify sync job");
  queueError.code = "INNGEST_QUEUE_ERROR";
  queueError.status = 503;
  queueError.cause = error;
  return queueError;
}

/**
 * Queue a background Shopify sync for one merchant.
 * Internal/scheduler routes must load merchants from DB before calling this.
 *
 * @param {{ merchantId: string, reason?: string }} params
 */
export async function queueShopifySyncForMerchant({ merchantId, reason }) {
  const data = buildShopifySyncEventData({ merchantId, reason });

  try {
    await inngest.send({
      name: SHOPIFY_SYNC_REQUESTED_EVENT,
      data,
    });
  } catch (error) {
    throw classifyInngestQueueError(error);
  }

  return {
    queued: true,
    merchantId: data.merchantId,
    reason: data.reason,
    requestedAt: data.requestedAt,
  };
}
