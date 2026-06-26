import "@shopify/shopify-api/adapters/node";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";
import { optionalEnv, requireEnv } from "@/lib/env";

/** @type {import("@shopify/shopify-api").Shopify | null} */
let shopify = null;

function resolveAppUrl() {
  const appUrl = optionalEnv("SHOPIFY_APP_URL") || optionalEnv("APP_URL");

  if (!appUrl) {
    requireEnv("SHOPIFY_APP_URL");
  }

  return appUrl.replace(/\/$/, "");
}

/**
 * Load Shopify app configuration from environment variables.
 */
export function getShopifyConfig() {
  const apiKey = requireEnv("SHOPIFY_API_KEY");
  const apiSecretKey = requireEnv("SHOPIFY_API_SECRET");
  const scopesString = optionalEnv("SHOPIFY_SCOPES", "read_orders");
  const scopes = scopesString
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const appUrl = resolveAppUrl();

  const appUrlParsed = new URL(appUrl);

  return {
    apiKey,
    apiSecretKey,
    scopes,
    scopesString: scopes.join(","),
    appUrl,
    hostName: appUrlParsed.host,
    hostScheme: appUrlParsed.protocol === "https:" ? "https" : "http",
  };
}

/**
 * Singleton Shopify API client (official @shopify/shopify-api).
 */
export function getShopify() {
  if (shopify) {
    return shopify;
  }

  const config = getShopifyConfig();

  shopify = shopifyApi({
    apiKey: config.apiKey,
    apiSecretKey: config.apiSecretKey,
    scopes: config.scopes,
    hostName: config.hostName,
    hostScheme: config.hostScheme,
    apiVersion: ApiVersion.January26,
    isEmbeddedApp: false,
  });

  return shopify;
}
