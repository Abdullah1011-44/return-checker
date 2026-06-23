import { isDevelopment } from "@/lib/env";
import { shopifyAdminRequest } from "@/lib/shopifyAdmin";

/**
 * Webhooks registered after install so Return Radar stays in sync with Shopify
 * without requiring manual sync for every order/product change.
 */
export const SHOPIFY_WEBHOOK_DEFINITIONS = [
  {
    topic: "orders/create",
    path: "/api/webhooks/orders-create",
    description:
      "Creates local CustomerOrder records when a new Shopify order is placed.",
  },
  {
    topic: "orders/updated",
    path: "/api/webhooks/orders-updated",
    description:
      "Updates order status, payment, fulfillment, and cancellation fields when Shopify orders change.",
  },
  {
    topic: "fulfillments/create",
    path: "/api/webhooks/fulfillments-create",
    description:
      "Captures fulfillment events so delivered/fulfilled state stays accurate for return eligibility.",
  },
  {
    topic: "products/update",
    path: "/api/webhooks/products-update",
    description:
      "Keeps synced Shopify product catalog metadata current when merchants edit products.",
  },
];

function normalizeAppUrl(appUrl) {
  if (!appUrl || typeof appUrl !== "string") {
    return null;
  }

  const trimmed = appUrl.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function resolveAppUrl() {
  return normalizeAppUrl(process.env.APP_URL);
}

function isLocalhostAppUrl(appUrl) {
  try {
    const hostname = new URL(appUrl).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function buildWebhookAddress(appUrl, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${appUrl}${normalizedPath}`;
}

function endpointPathFromAddress(address, appUrl) {
  if (!address || !appUrl) {
    return null;
  }

  if (address.startsWith(appUrl)) {
    return address.slice(appUrl.length) || "/";
  }

  try {
    return new URL(address).pathname;
  } catch {
    return null;
  }
}

function normalizeShopDomain(shopDomain) {
  if (!shopDomain || typeof shopDomain !== "string") {
    return null;
  }

  const trimmed = shopDomain.trim().toLowerCase();
  return trimmed || null;
}

function webhookAlreadyExists(existingWebhooks, topic, address) {
  return existingWebhooks.some(
    (webhook) => webhook?.topic === topic && webhook?.address === address
  );
}

function logWebhookRegistration({ shopDomain, topic, endpointPath, status }) {
  console.log("[Shopify Webhook Registration]", {
    shopDomain,
    topic,
    endpointPath,
    status,
  });
}

async function fetchExistingWebhooks(shopDomain, accessToken) {
  const { data } = await shopifyAdminRequest(
    shopDomain,
    accessToken,
    "/webhooks.json"
  );

  return Array.isArray(data?.webhooks) ? data.webhooks : [];
}

async function createShopifyWebhook(shopDomain, accessToken, topic, address) {
  await shopifyAdminRequest(shopDomain, accessToken, "/webhooks.json", {
    method: "POST",
    body: {
      webhook: {
        topic,
        address,
        format: "json",
      },
    },
  });
}

/**
 * Register required Shopify webhooks for a connected merchant.
 * Safe for OAuth install flows — validation and per-topic errors never throw.
 *
 * @param {{ shopDomain: string, accessToken: string }} params
 * @returns {Promise<{
 *   success: boolean,
 *   registered: Array<{ topic: string, endpointPath: string, address: string }>,
 *   skipped: Array<{ topic: string, endpointPath: string, address: string, reason: string }>,
 *   failed: Array<{ topic?: string, endpointPath?: string, reason: string, status?: number }>
 * }>}
 */
export async function registerShopifyWebhooks({ shopDomain, accessToken }) {
  const result = {
    success: false,
    registered: [],
    skipped: [],
    failed: [],
  };

  const normalizedShopDomain = normalizeShopDomain(shopDomain);
  if (!normalizedShopDomain) {
    result.failed.push({
      reason: "Missing shopDomain",
    });
    return result;
  }

  if (!accessToken) {
    result.failed.push({
      reason: "Missing accessToken",
    });
    return result;
  }

  const appUrl = resolveAppUrl();
  if (!appUrl) {
    result.failed.push({
      reason: "Missing APP_URL",
    });
    return result;
  }

  if (isLocalhostAppUrl(appUrl) && !isDevelopment()) {
    result.failed.push({
      reason: "APP_URL points to localhost outside development",
    });
    return result;
  }

  let existingWebhooks = [];

  try {
    existingWebhooks = await fetchExistingWebhooks(
      normalizedShopDomain,
      accessToken
    );
  } catch (error) {
    result.failed.push({
      reason: "Failed to fetch existing Shopify webhooks",
      status: error?.status,
    });
    logWebhookRegistration({
      shopDomain: normalizedShopDomain,
      topic: "*",
      endpointPath: "/webhooks.json",
      status: "failed",
    });
    return result;
  }

  for (const definition of SHOPIFY_WEBHOOK_DEFINITIONS) {
    const address = buildWebhookAddress(appUrl, definition.path);
    const endpointPath = definition.path;

    if (webhookAlreadyExists(existingWebhooks, definition.topic, address)) {
      result.skipped.push({
        topic: definition.topic,
        endpointPath,
        address,
        reason: "Webhook already registered",
      });
      logWebhookRegistration({
        shopDomain: normalizedShopDomain,
        topic: definition.topic,
        endpointPath,
        status: "skipped",
      });
      continue;
    }

    try {
      await createShopifyWebhook(
        normalizedShopDomain,
        accessToken,
        definition.topic,
        address
      );

      result.registered.push({
        topic: definition.topic,
        endpointPath,
        address,
      });
      logWebhookRegistration({
        shopDomain: normalizedShopDomain,
        topic: definition.topic,
        endpointPath,
        status: "registered",
      });
    } catch (error) {
      result.failed.push({
        topic: definition.topic,
        endpointPath,
        reason: "Shopify webhook registration failed",
        status: error?.status,
      });
      logWebhookRegistration({
        shopDomain: normalizedShopDomain,
        topic: definition.topic,
        endpointPath,
        status: "failed",
      });
    }
  }

  result.success = result.failed.length === 0;
  return result;
}

export {
  buildWebhookAddress,
  endpointPathFromAddress,
  normalizeAppUrl,
  webhookAlreadyExists,
};
