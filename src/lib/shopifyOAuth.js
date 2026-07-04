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
  return `${appUrl.replace(/\/$/, "")}/api/auth/callback`;
}

/**
 * Build the merchant-facing reinstall URL for a shop domain.
 * @param {string} shopDomain
 */
export function buildShopifyInstallUrl(shopDomain) {
  const shopCheck = validateShopDomain(shopDomain);
  if (!shopCheck.valid) {
    return null;
  }

  const { appUrl } = getShopifyEnv();
  const params = new URLSearchParams({ shop: shopCheck.shop });
  return `${appUrl.replace(/\/$/, "")}/api/auth/install?${params.toString()}`;
}

/**
 * Safe credential fingerprint for development logs (never log full secrets).
 */
export function getShopifyCredentialFingerprint() {
  const { apiKey, appUrl } = getShopifyEnv();
  const apiKeySuffix =
    typeof apiKey === "string" && apiKey.length >= 4
      ? apiKey.slice(-4)
      : "unknown";

  return {
    apiKeySuffix,
    appUrl,
    redirectUri: getOAuthRedirectUri(appUrl),
  };
}

function logShopifyOAuthDev(phase, payload) {
  if (isDevelopment()) {
    console.debug(`[Shopify OAuth:${phase}]`, payload);
  }
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
  const { apiKey, apiSecret, appUrl } = getShopifyEnv();
  const redirectUri = getOAuthRedirectUri(appUrl);

  logShopifyOAuthDev("token-exchange:start", {
    shopDomain: shop,
    hasCode: Boolean(code),
    redirectUri,
    ...getShopifyCredentialFingerprint(),
  });

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data.error_description ||
      data.error ||
      "Failed to exchange authorization code for access token.";

    logShopifyOAuthDev("token-exchange:failed", {
      shopDomain: shop,
      httpStatus: response.status,
      errorSummary: message,
    });

    throw new Error(message);
  }

  if (!data.access_token) {
    logShopifyOAuthDev("token-exchange:failed", {
      shopDomain: shop,
      httpStatus: response.status,
      errorSummary: "Missing access_token in Shopify response",
    });
    throw new Error("Shopify did not return an access token.");
  }

  const accessToken = String(data.access_token).trim();
  const scope = data.scope ?? null;

  logShopifyOAuthDev("token-exchange:succeeded", {
    shopDomain: shop,
    accessTokenLength: accessToken.length,
    scopes: scope,
  });

  return {
    accessToken,
    scope,
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
 * Finds merchants by shopDomain case-insensitively so reinstall always
 * overwrites stale tokens on the same shop.
 */
export async function upsertMerchantFromOAuth(
  prisma,
  shop,
  accessToken,
  returnedScopes,
) {
  const normalizedShop = shop.trim().toLowerCase();
  const normalizedToken = String(accessToken).trim();

  if (!normalizedToken) {
    throw new Error("Shopify access token is empty after OAuth.");
  }

  const shopName =
    normalizedShop.replace(SHOP_DOMAIN_SUFFIX, "") || normalizedShop;
  const installEmail = `auth+${normalizedShop}@shopify.install`;

  const scopeValue =
    returnedScopes ?? optionalEnv("SHOPIFY_SCOPES", "read_orders");

  const existing = await prisma.merchant.findFirst({
    where: {
      shopDomain: {
        equals: normalizedShop,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      shopDomain: true,
      shopifyAccessToken: true,
    },
  });

  const merchantData = {
    shopDomain: normalizedShop,
    shopifyAccessToken: normalizedToken,
    shopifyInstalledAt: new Date(),
    shopifyUninstalledAt: null,
    isActive: true,
    ...(scopeValue ? { shopifyScope: scopeValue } : {}),
  };

  let merchant;
  let operation = "created";

  if (existing) {
    operation = "updated";
    merchant = await prisma.merchant.update({
      where: { id: existing.id },
      data: merchantData,
    });
  } else {
    merchant = await prisma.merchant.create({
      data: {
        ...merchantData,
        shopName,
        email: installEmail,
      },
    });
  }

  logShopifyOAuthDev("merchant-upsert:succeeded", {
    shopDomain: normalizedShop,
    merchantId: merchant.id,
    operation,
    accessTokenLength: normalizedToken.length,
    previousTokenLength: existing?.shopifyAccessToken?.length ?? 0,
    tokenReplaced:
      !existing?.shopifyAccessToken ||
      existing.shopifyAccessToken !== normalizedToken,
    scopes: scopeValue,
  });

  return merchant;
}
