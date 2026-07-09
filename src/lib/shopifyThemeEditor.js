const MYShopify_DOMAIN_PATTERN = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/;

/**
 * Build the Shopify admin theme editor URL for a connected store.
 * Example: my-store.myshopify.com -> https://admin.shopify.com/store/my-store/themes
 *
 * @param {unknown} shopDomain
 * @returns {string | null}
 */
export function buildShopifyThemeEditorUrl(shopDomain) {
  if (!shopDomain || typeof shopDomain !== "string") {
    return null;
  }

  const normalized = shopDomain.trim().toLowerCase();
  const match = MYShopify_DOMAIN_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }

  return `https://admin.shopify.com/store/${match[1]}/themes`;
}
