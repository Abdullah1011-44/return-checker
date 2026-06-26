import crypto from "node:crypto";
import { InvalidHmacError } from "@shopify/shopify-api";
import { isDevelopment, optionalEnv } from "@/lib/env";
import { getShopify, getShopifyConfig } from "@/lib/shopify";

export const SHOPIFY_OAUTH_STATE_COOKIE = "shopify_oauth_state";

const SHOP_DOMAIN_SUFFIX = ".myshopify.com";

/**
 * Load Shopify app credentials from environment (compat helper for routes).
 */
export function getShopifyEnv() {
  const config = getShopifyConfig();
  return {
    apiKey: config.apiKey,
    apiSecret: config.apiSecretKey,
    scopes: config.scopesString,
    appUrl: config.appUrl,
  };
}

/** OAuth redirect_uri registered in Shopify Partner Dashboard */
export function getOAuthRedirectUri(appUrl) {
  return `${appUrl}/api/auth/callback`;
}

/**
 * Normalize and validate a Shopify shop domain.
 * Rejects protocols and non-*.myshopify.com hosts.
 */
export function validateShopDomain(shop) {
  if (!shop || typeof shop !== "string") {
    return { valid: false, error: "Shop parameter is required." };
  }

  const trimmed = shop.trim().toLowerCase();

  if (trimmed.includes("http://") || trimmed.includes("https://")) {
    return {
      valid: false,
      error: "Shop must not include http:// or https://.",
    };
  }

  if (!trimmed.endsWith(SHOP_DOMAIN_SUFFIX)) {
    return {
      valid: false,
      error: `Shop must end with ${SHOP_DOMAIN_SUFFIX}.`,
    };
  }

  const hostname = trimmed.slice(0, -SHOP_DOMAIN_SUFFIX.length);
  if (!hostname || hostname.includes("/") || hostname.includes(" ")) {
    return { valid: false, error: "Invalid shop domain format." };
  }

  return { valid: true, shop: trimmed };
}

/** Cryptographically secure OAuth state (CSRF protection) */
export function generateOAuthState() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Step 1 of OAuth: build Shopify authorize URL.
 * Merchant is sent here to grant scopes.
 */
export function buildAuthorizeUrl({
  shop,
  state,
  apiKey,
  scopes,
  redirectUri,
}) {
  const params = new URLSearchParams({
    client_id: apiKey,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });

  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Verify OAuth callback query signature.
 *
 * Uses `shopify.utils.validateHmac` — the same helper `shopify.auth.callback`
 * calls internally via `validQuery()` in @shopify/shopify-api v13.
 *
 * Package signature (@shopify/shopify-api ^13.0.0):
 *   validateHmac(
 *     query: AuthQuery,
 *     options?: { signator?: 'admin' | 'appProxy' }
 *   ): Promise<boolean>
 *
 * - `signator: 'admin'` (default) — OAuth install/callback (`hmac` param)
 * - `signator: 'appProxy'` — App proxy (`signature` param)
 * - Webhooks use `shopify.webhooks.validate()` / `validateHmacFromRequest`, not this.
 *
 * Full OAuth flow alternative (not used here — custom state cookie + token exchange):
 *   shopify.auth.callback({ rawRequest, rawResponse }): Promise<CallbackResponse>
 *
 * @param {Record<string, string>} query — plain object from Object.fromEntries(searchParams.entries())
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 */
export async function verifyShopifyOAuthCallback(query) {
  const isDev = isDevelopment();

  if (!query.hmac) {
    return {
      valid: false,
      error: isDev
        ? "Missing hmac query parameter."
        : "Invalid HMAC signature.",
    };
  }

  try {
    const shopify = getShopify();

    if (isDev) {
      console.log("[Shopify OAuth] validateHmac", {
        apiVersion: shopify.config.apiVersion,
        queryKeys: Object.keys(query).sort(),
      });
    }

    // Default signator "admin" — OAuth callbacks (not app proxy / webhooks)
    const valid = await shopify.utils.validateHmac(query, {
      signator: "admin",
    });

    if (!valid) {
      return {
        valid: false,
        error: isDev
          ? "Invalid HMAC signature (computed digest does not match query.hmac). Check SHOPIFY_API_SECRET and that query was built with Object.fromEntries(searchParams.entries())."
          : "Invalid HMAC signature.",
        debug: isDev ? { queryKeys: Object.keys(query).sort() } : undefined,
      };
    }

    return { valid: true };
  } catch (error) {
    if (error instanceof InvalidHmacError) {
      if (isDev) {
        console.log("[Shopify OAuth] validateHmac failed", {
          message: error.message,
          queryKeys: Object.keys(query).sort(),
        });
      }
      return {
        valid: false,
        error: isDev ? error.message : "Invalid HMAC signature.",
        debug: isDev
          ? {
              queryKeys: Object.keys(query).sort(),
              timestamp: query.timestamp,
            }
          : undefined,
      };
    }
    throw error;
  }
}

/**
 * Step 2 of OAuth: exchange authorization code for offline/online access token.
 * Token is stored server-side only — never sent to the browser.
 */
export async function exchangeAuthorizationCode(shop, code) {
  const { apiKey, apiSecret } = getShopifyEnv();

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.error_description ||
      data.error ||
      "Failed to exchange authorization code for access token.";
    throw new Error(message);
  }

  if (!data.access_token) {
    throw new Error("Shopify did not return an access token.");
  }

  return {
    accessToken: data.access_token,
    scope: data.scope ?? null,
  };
}

/** Cookie options for OAuth state (httpOnly, short-lived) */
export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: !isDevelopment(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  };
}

/**
 * Persist installed shop after successful OAuth.
 * Uses shopDomain as the unique key for upsert.
 */
export async function upsertMerchantFromOAuth(
  prisma,
  shop,
  accessToken,
  returnedScopes,
) {
  // Temporary placeholders until merchant profile sync from Shopify Admin API
  const shopName = shop.replace(SHOP_DOMAIN_SUFFIX, "") || shop;
  const installEmail = `auth+${shop}@shopify.install`;

  const scopeValue =
    returnedScopes ?? optionalEnv("SHOPIFY_SCOPES", "read_orders");

  return prisma.merchant.upsert({
    where: { shopDomain: shop },
    update: {
      shopifyAccessToken: accessToken,
      shopifyInstalledAt: new Date(),
      shopifyUninstalledAt: null,
      isActive: true,
      ...(scopeValue ? { shopifyScope: scopeValue } : {}),
    },
    create: {
      shopDomain: shop,
      shopifyAccessToken: accessToken,
      shopifyScope: scopeValue,
      shopifyInstalledAt: new Date(),
      isActive: true,
      shopName,
      email: installEmail,
    },
  });
}
