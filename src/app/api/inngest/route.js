/**
 * Inngest serve endpoint — background job execution only.
 *
 * Inngest invokes GET (metadata/dev UI), POST (run steps), and PUT (register
 * functions) here. This is not a public merchant API and does not use
 * merchant_session cookies.
 *
 * Security:
 * - Do not log Shopify access tokens, customer PII, or raw Shopify payloads.
 * - Production requests are verified via INNGEST_SIGNING_KEY (SDK default).
 */
import { serve } from "inngest/next";
import { syncShopifyData } from "@/lib/inngestFunctions/shopifySync";
import { inngest } from "@/lib/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncShopifyData],
});
