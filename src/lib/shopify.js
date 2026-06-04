import "@shopify/shopify-api/adapters/node";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";

/** @type {import("@shopify/shopify-api").Shopify | null} */
let shopify = null;

/**
 * Load Shopify app configuration from environment variables.
 */
export function getShopifyConfig() {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecretKey = process.env.SHOPIFY_API_SECRET?.trim();
  const scopes = process.env.SHOPIFY_SCOPES?.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const appUrl = process.env.SHOPIFY_APP_URL?.replace(/\/$/, "");

  if (!apiKey || !apiSecretKey || !scopes?.length || !appUrl) {
    throw new Error(
      "Missing Shopify configuration. Set SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_SCOPES, and SHOPIFY_APP_URL."
    );
  }

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
