import { Inngest } from "inngest";

/**
 * Inngest client for ReturnRadar background jobs (Shopify sync queue, etc.).
 *
 * Production (optional until you deploy Inngest):
 * - INNGEST_SIGNING_KEY — verifies requests to /api/inngest
 * - INNGEST_EVENT_KEY — sending events from the app (future tasks)
 *
 * Local development:
 * - Run `npx inngest-cli@latest dev` alongside `npm run dev`
 * - No production secrets required; the dev server discovers /api/inngest
 *
 * Security: job handlers must never log Shopify access tokens, customer email,
 * phone, address, names, or raw Shopify webhook/API payloads.
 */
export const inngest = new Inngest({
  id: "return-radar",
  name: "ReturnRadar",
});
