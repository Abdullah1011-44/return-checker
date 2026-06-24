import { NonRetriableError } from "inngest";
import { sanitizeAuditMetadata } from "@/lib/audit";
import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/prisma";
import {
  runShopifySyncForMerchant,
  ShopifySyncRunnerError,
} from "@/lib/shopifySyncRunner";
import { SHOPIFY_SYNC_REQUESTED_EVENT } from "@/lib/shopifySyncQueue";

function readEventPayload(event) {
  const merchantId = event?.data?.merchantId;
  const reason =
    typeof event?.data?.reason === "string" && event.data.reason.trim()
      ? event.data.reason.trim()
      : "queue";

  return { merchantId, reason };
}

async function assertMerchantExists(merchantId) {
  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true },
  });

  if (!merchant) {
    throw new NonRetriableError("Merchant not found");
  }
}

/**
 * Background worker: runs full Shopify order/status/product sync for one merchant.
 */
export const syncShopifyData = inngest.createFunction(
  {
    id: "sync-shopify-data",
    name: "Sync Shopify Data",
    retries: 3,
    triggers: [{ event: SHOPIFY_SYNC_REQUESTED_EVENT }],
  },
  async ({ event }) => {
    const { merchantId, reason } = readEventPayload(event);

    if (!merchantId || typeof merchantId !== "string") {
      throw new NonRetriableError("Invalid merchantId in sync event");
    }

    console.log(
      "[Inngest Shopify Sync] started",
      sanitizeAuditMetadata({ merchantId, reason })
    );

    await assertMerchantExists(merchantId);

    try {
      const summary = await runShopifySyncForMerchant({ merchantId, reason });

      console.log(
        "[Inngest Shopify Sync] completed",
        sanitizeAuditMetadata({
          merchantId: summary.merchantId,
          shopDomain: summary.shopDomain,
          ordersSynced: summary.ordersSynced,
          productsSynced: summary.productsSynced,
          statusUpdated: summary.statusUpdated,
        })
      );

      return summary;
    } catch (error) {
      console.error(
        "[Inngest Shopify Sync] failed",
        sanitizeAuditMetadata({
          merchantId,
          reason,
          code: error?.code ?? null,
          message:
            error instanceof Error ? error.message : "Shopify sync job failed",
        })
      );

      if (error instanceof ShopifySyncRunnerError && !error.retryable) {
        throw new NonRetriableError(error.message);
      }

      if (error instanceof ShopifySyncRunnerError) {
        throw error;
      }

      throw new ShopifySyncRunnerError(
        error instanceof Error ? error.message : "Shopify sync job failed",
        {
          merchantId,
          code: error?.code ?? "SHOPIFY_SYNC_RUNNER_ERROR",
        }
      );
    }
  }
);
