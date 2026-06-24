import { Inngest } from "inngest";

/**
 * Inngest client for ReturnRadar background jobs (Shopify sync queue, etc.).
 *
 * Production (optional until you deploy Inngest):
 * - INNGEST_SIGNING_KEY — verifies requests to /api/inngest
 * - INNGEST_EVENT_KEY — sending events from the app
 *
 * Local development:
 * - Run `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest`
 *   alongside `npm run dev`
 * - No production secrets required; the dev server discovers /api/inngest
 *
 * Security: never log INNGEST_SIGNING_KEY, INNGEST_EVENT_KEY, Shopify access
 * tokens, customer PII, or raw Shopify webhook/API payloads in job handlers.
 */
export const inngest = new Inngest({
  id: "return-radar",
  name: "ReturnRadar",
});
