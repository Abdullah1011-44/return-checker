import { optionalEnv } from "@/lib/env";

export const SHOPIFY_ADMIN_API_VERSION = optionalEnv(
  "SHOPIFY_ADMIN_API_VERSION",
  "2026-04"
);

const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfterHeader) {
  if (!retryAfterHeader) {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const seconds = Number.parseInt(retryAfterHeader, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(dateMs)) {
    const waitMs = dateMs - Date.now();
    return waitMs > 0 ? waitMs : DEFAULT_RETRY_AFTER_MS;
  }

  return DEFAULT_RETRY_AFTER_MS;
}

/**
 * Call the Shopify Admin REST API for a connected shop.
 * Never log accessToken, request headers, cookies, or env secrets.
 */
export async function shopifyAdminRequest(
  shopDomain,
  accessToken,
  endpoint,
  options = {}
) {
  if (!shopDomain || !accessToken) {
    throw new Error("Shopify Admin API request failed");
  }

  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;

  const url = `https://${shopDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}${normalizedEndpoint}`;

  const { method = "GET", body } = options;

  let attempt = 0;

  while (attempt <= MAX_RATE_LIMIT_RETRIES) {
    let response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (networkError) {
      const error = new Error("Unable to connect to Shopify");
      error.code = "SHOPIFY_NETWORK_ERROR";
      error.endpoint = normalizedEndpoint;
      error.cause = networkError;
      throw error;
    }

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("Retry-After")
      );
      await sleep(retryAfterMs);
      attempt += 1;
      continue;
    }

    const bodyText = await response.text().catch(() => "");
    let data = null;

    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const isProtectedCustomerDataError =
        response.status === 403 &&
        bodyText.toLowerCase().includes("protected customer data");

      console.error("[Shopify Admin API Error]", {
        status: response.status,
        shopDomain,
        endpoint: normalizedEndpoint,
        code: isProtectedCustomerDataError
          ? "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"
          : "SHOPIFY_API_ERROR",
        hasToken: Boolean(accessToken),
      });

      if (isProtectedCustomerDataError) {
        const error = new Error("SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED");
        error.code = "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED";
        error.status = 403;
        error.endpoint = normalizedEndpoint;
        throw error;
      }

      const error = new Error("Shopify Admin API request failed");
      error.status = response.status;
      error.code = "SHOPIFY_API_ERROR";
      error.endpoint = normalizedEndpoint;
      throw error;
    }

    return {
      data,
      headers: response.headers,
      status: response.status,
    };
  }

  const error = new Error("Shopify Admin API request failed");
  error.status = 429;
  error.code = "SHOPIFY_API_ERROR";
  error.endpoint = normalizedEndpoint;
  throw error;
}

/**
 * Extract the next-page endpoint from Shopify's Link header.
 * Returns a path like /orders.json?page_info=...&limit=50
 */
export function parseShopifyNextEndpoint(linkHeader) {
  if (!linkHeader) {
    return null;
  }

  for (const part of linkHeader.split(",")) {
    const match = part.trim().match(/<([^>]+)>;\s*rel="next"/i);
    if (!match) {
      continue;
    }

    const nextUrl = new URL(match[1]);
    const apiPrefix = `/admin/api/${SHOPIFY_ADMIN_API_VERSION}`;
    const pathAfterVersion = nextUrl.pathname.includes(apiPrefix)
      ? nextUrl.pathname.slice(nextUrl.pathname.indexOf(apiPrefix) + apiPrefix.length)
      : nextUrl.pathname;

    return `${pathAfterVersion}${nextUrl.search}`;
  }

  return null;
}
