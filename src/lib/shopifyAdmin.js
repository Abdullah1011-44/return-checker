import { optionalEnv } from "@/lib/env";

export const SHOPIFY_ADMIN_API_VERSION = optionalEnv(
  "SHOPIFY_ADMIN_API_VERSION",
  "2026-04",
);

const IS_DEV = process.env.NODE_ENV === "development";
const SHOP_DOMAIN_SUFFIX = ".myshopify.com";
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SHOPIFY_BASE_URL_ENV_KEYS = [
  "SHOPIFY_ADMIN_API_URL",
  "SHOPIFY_API_BASE_URL",
];
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_AFTER_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function debugShopifyAdmin(phase, payload) {
  if (IS_DEV) {
    console.debug(`[shopify-admin:${phase}]`, payload);
  }
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
 * Redact tokens, emails, and long raw payloads from Shopify error text.
 * @param {unknown} value
 */
export function sanitizeShopifyErrorText(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .replace(/shpat_[a-zA-Z0-9]+/gi, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, "[REDACTED_EMAIL]")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} bodyText
 * @param {unknown} data
 */
export function summarizeShopifyErrorBody(bodyText, data) {
  const parts = [];

  if (data && typeof data === "object") {
    const record = /** @type {Record<string, unknown>} */ (data);
    if (typeof record.errors === "string") {
      parts.push(record.errors);
    } else if (record.errors != null) {
      parts.push(JSON.stringify(record.errors));
    } else if (typeof record.error === "string") {
      parts.push(record.error);
    }
  }

  if (parts.length === 0 && bodyText) {
    parts.push(bodyText);
  }

  const summary = sanitizeShopifyErrorText(parts.join(" "));
  return summary ? summary.slice(0, 300) : null;
}

/**
 * @param {number} status
 * @param {string} bodyText
 */
export function mapShopifyAdminHttpErrorCode(status, bodyText = "") {
  if (status === 401) {
    return "SHOPIFY_TOKEN_INVALID";
  }

  if (status === 403) {
    if (bodyText.toLowerCase().includes("protected customer data")) {
      return "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED";
    }

    return "SHOPIFY_ORDER_ACCESS_DENIED";
  }

  if (status === 404) {
    return "SHOPIFY_ENDPOINT_NOT_FOUND";
  }

  if (status === 429) {
    return "SHOPIFY_RATE_LIMITED";
  }

  return "SHOPIFY_API_ERROR";
}

function createShopifyDomainError(
  message,
  code = "SHOPIFY_INVALID_SHOP_DOMAIN",
) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isLocalhostHost(hostname) {
  return LOCALHOST_HOSTS.has(hostname.toLowerCase());
}

/**
 * Reject localhost Shopify base URLs outside test runs.
 * @param {string} rawUrl
 */
export function validateShopifyBaseUrlOverride(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw createShopifyDomainError("Invalid Shopify base URL");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw createShopifyDomainError("Invalid Shopify base URL");
  }

  if (process.env.NODE_ENV === "test") {
    return parsed;
  }

  if (isLocalhostHost(parsed.hostname)) {
    throw createShopifyDomainError(
      "Shopify base URL cannot point to localhost for dashboard sync",
    );
  }

  if (!parsed.hostname.endsWith(SHOP_DOMAIN_SUFFIX)) {
    throw createShopifyDomainError(
      "Shopify base URL must use a *.myshopify.com host",
    );
  }

  return parsed;
}

/**
 * Guard optional Shopify base URL env vars from pointing sync at localhost.
 */
export function assertSafeShopifyBaseUrlEnv() {
  for (const key of SHOPIFY_BASE_URL_ENV_KEYS) {
    const value = optionalEnv(key);
    if (value) {
      validateShopifyBaseUrlOverride(value);
    }
  }
}

/**
 * Normalize and validate a merchant shop domain for Admin API calls.
 * @param {string} shopDomain
 */
export function validateShopifyAdminShopDomain(shopDomain) {
  if (!shopDomain || typeof shopDomain !== "string") {
    throw createShopifyDomainError("Invalid Shopify shop domain");
  }

  const normalized = shopDomain.trim().toLowerCase();

  if (normalized.includes("://")) {
    throw createShopifyDomainError(
      "Shopify shop domain must not include a protocol",
    );
  }

  const hostname = normalized.split("/")[0].split(":")[0];
  if (process.env.NODE_ENV !== "test" && isLocalhostHost(hostname)) {
    throw createShopifyDomainError(
      "Shopify Admin API cannot use localhost as shop domain",
    );
  }

  if (!normalized.endsWith(SHOP_DOMAIN_SUFFIX)) {
    throw createShopifyDomainError(
      `Shopify shop domain must end with ${SHOP_DOMAIN_SUFFIX}`,
    );
  }

  const shopName = normalized.slice(0, -SHOP_DOMAIN_SUFFIX.length);
  if (!shopName || shopName.includes("/") || shopName.includes(" ")) {
    throw createShopifyDomainError("Invalid Shopify shop domain format");
  }

  return normalized;
}

/**
 * Build a Shopify Admin REST URL from the merchant shop domain.
 * @param {string} shopDomain
 * @param {string} endpoint
 */
export function buildShopifyAdminRestUrl(shopDomain, endpoint) {
  assertSafeShopifyBaseUrlEnv();

  const normalizedShop = validateShopifyAdminShopDomain(shopDomain);
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;

  return `https://${normalizedShop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}${normalizedEndpoint}`;
}

/**
 * Build a Shopify Admin GraphQL URL from the merchant shop domain.
 * @param {string} shopDomain
 */
export function buildShopifyAdminGraphqlUrl(shopDomain) {
  return buildShopifyAdminRestUrl(shopDomain, "/graphql.json");
}

/**
 * @param {{
 *   status: number;
 *   endpoint: string;
 *   bodyText?: string;
 *   data?: unknown;
 *   shopDomain?: string;
 * }} input
 */
export function buildShopifyAdminHttpError({
  status,
  endpoint,
  bodyText = "",
  data = null,
  shopDomain = null,
}) {
  const code = mapShopifyAdminHttpErrorCode(status, bodyText);
  const errorSummary = summarizeShopifyErrorBody(bodyText, data);
  const messageByCode = {
    SHOPIFY_TOKEN_INVALID: "Shopify access token is invalid",
    SHOPIFY_ORDER_ACCESS_DENIED: "Shopify denied order access",
    SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED:
      "Shopify protected customer data access required",
    SHOPIFY_ENDPOINT_NOT_FOUND: "Shopify Admin API endpoint not found",
    SHOPIFY_RATE_LIMITED: "Shopify rate limit reached",
    SHOPIFY_API_ERROR: "Shopify Admin API request failed",
  };

  const error = new Error(
    messageByCode[code] ?? "Shopify Admin API request failed",
  );
  error.status = status;
  error.code = code;
  error.endpoint = endpoint;
  error.apiType = "REST";
  error.apiVersion = SHOPIFY_ADMIN_API_VERSION;
  error.errorSummary = errorSummary;
  error.shopDomain = shopDomain ?? null;
  return error;
}

/**
 * Call the Shopify Admin REST API for a connected shop.
 * Never log accessToken, request headers, cookies, or env secrets.
 */
export async function shopifyAdminRequest(
  shopDomain,
  accessToken,
  endpoint,
  options = {},
) {
  if (!shopDomain || !accessToken) {
    throw new Error("Shopify Admin API request failed");
  }

  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint
    : `/${endpoint}`;

  const normalizedShop = validateShopifyAdminShopDomain(shopDomain);
  const url = buildShopifyAdminRestUrl(normalizedShop, normalizedEndpoint);

  const { method = "GET", body } = options;

  debugShopifyAdmin("request:start", {
    shopDomain: normalizedShop,
    apiType: "REST",
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    endpoint: normalizedEndpoint,
    method,
    hasToken: Boolean(accessToken),
  });

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
      debugShopifyAdmin("request:network-error", {
        shopDomain: normalizedShop,
        endpoint: normalizedEndpoint,
        errorName: networkError instanceof Error ? networkError.name : "Error",
      });

      const error = new Error("Unable to connect to Shopify");
      error.code = "SHOPIFY_NETWORK_ERROR";
      error.endpoint = normalizedEndpoint;
      error.apiType = "REST";
      error.apiVersion = SHOPIFY_ADMIN_API_VERSION;
      error.shopDomain = normalizedShop;
      error.cause = networkError;
      throw error;
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

    debugShopifyAdmin("request:response", {
      shopDomain: normalizedShop,
      endpoint: normalizedEndpoint,
      status: response.status,
      ok: response.ok,
      errorSummary: response.ok
        ? null
        : summarizeShopifyErrorBody(bodyText, data),
    });

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get("Retry-After"),
      );
      await sleep(retryAfterMs);
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      const httpError = buildShopifyAdminHttpError({
        status: response.status,
        endpoint: normalizedEndpoint,
        bodyText,
        data,
        shopDomain: normalizedShop,
      });

      console.error("[Shopify Admin API Error]", {
        status: response.status,
        shopDomain: normalizedShop,
        endpoint: normalizedEndpoint,
        apiType: "REST",
        apiVersion: SHOPIFY_ADMIN_API_VERSION,
        code: httpError.code,
        errorSummary: httpError.errorSummary,
        hasToken: Boolean(accessToken),
      });

      throw httpError;
    }

    return {
      data,
      headers: response.headers,
      status: response.status,
    };
  }

  const rateLimitError = buildShopifyAdminHttpError({
    status: 429,
    endpoint: normalizedEndpoint,
    bodyText: "Rate limit exceeded after retries",
    shopDomain: normalizedShop,
  });

  console.error("[Shopify Admin API Error]", {
    status: 429,
    shopDomain: normalizedShop,
    endpoint: normalizedEndpoint,
    apiType: "REST",
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    code: rateLimitError.code,
    errorSummary: rateLimitError.errorSummary,
    hasToken: Boolean(accessToken),
  });

  throw rateLimitError;
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
      ? nextUrl.pathname.slice(
          nextUrl.pathname.indexOf(apiPrefix) + apiPrefix.length,
        )
      : nextUrl.pathname;

    return `${pathAfterVersion}${nextUrl.search}`;
  }

  return null;
}

/**
 * Call the Shopify Admin GraphQL API for a connected shop.
 *
 * Used for new GraphQL-based features (e.g. Task 20 product sync).
 * Task 19 order sync continues to use {@link shopifyAdminRequest} (REST).
 *
 * POSTs to `/admin/api/{version}/graphql.json` with `{ query, variables }`.
 * Returns `data` from the GraphQL response. Never logs accessToken or secrets.
 *
 * @param {object} params
 * @param {string} params.shopDomain
 * @param {string} params.accessToken
 * @param {string} params.query
 * @param {Record<string, unknown>} [params.variables]
 * @returns {Promise<unknown>}
 */
export async function shopifyAdminGraphqlRequest({
  shopDomain,
  accessToken,
  query,
  variables = {},
}) {
  if (!shopDomain || !accessToken) {
    throw new Error("Shopify GraphQL request failed");
  }

  if (!query) {
    throw new Error("Shopify GraphQL request failed: query is required");
  }

  const normalizedShop = validateShopifyAdminShopDomain(shopDomain);
  const url = buildShopifyAdminGraphqlUrl(normalizedShop);

  debugShopifyAdmin("request:start", {
    shopDomain: normalizedShop,
    apiType: "GraphQL",
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    endpoint: "/graphql.json",
    method: "POST",
    hasToken: Boolean(accessToken),
  });

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (networkError) {
    debugShopifyAdmin("request:network-error", {
      shopDomain: normalizedShop,
      endpoint: "/graphql.json",
      errorName: networkError instanceof Error ? networkError.name : "Error",
    });

    const error = new Error("Unable to connect to Shopify GraphQL API");
    error.code = "SHOPIFY_NETWORK_ERROR";
    error.endpoint = "/graphql.json";
    error.apiType = "GraphQL";
    error.apiVersion = SHOPIFY_ADMIN_API_VERSION;
    error.shopDomain = normalizedShop;
    error.cause = networkError;
    throw error;
  }

  const bodyText = await response.text().catch(() => "");

  debugShopifyAdmin("request:response", {
    shopDomain: normalizedShop,
    endpoint: "/graphql.json",
    status: response.status,
    ok: response.ok,
    errorSummary: response.ok
      ? null
      : sanitizeShopifyErrorText(bodyText).slice(0, 300) || null,
  });

  if (!response.ok) {
    const safeSnippet = sanitizeShopifyErrorText(bodyText);

    console.error("[Shopify GraphQL API Error]", {
      status: response.status,
      shopDomain: normalizedShop,
      code: "SHOPIFY_GRAPHQL_HTTP_ERROR",
      hasToken: Boolean(accessToken),
    });

    const error = new Error(
      safeSnippet
        ? `Shopify GraphQL request failed with HTTP ${response.status}: ${safeSnippet}`
        : `Shopify GraphQL request failed with HTTP ${response.status}`,
    );
    error.status = response.status;
    error.code = "SHOPIFY_GRAPHQL_HTTP_ERROR";
    throw error;
  }

  let payload = null;

  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      const error = new Error("Shopify GraphQL response was not valid JSON");
      error.code = "SHOPIFY_GRAPHQL_PARSE_ERROR";
      throw error;
    }
  }

  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const messages = payload.errors
      .map((entry) => entry?.message)
      .filter(Boolean)
      .join("; ");

    console.error("[Shopify GraphQL API Error]", {
      shopDomain: normalizedShop,
      code: "SHOPIFY_GRAPHQL_ERRORS",
      errorCount: payload.errors.length,
      hasToken: Boolean(accessToken),
    });

    const error = new Error(
      messages || "Shopify GraphQL request returned errors",
    );
    error.code = "SHOPIFY_GRAPHQL_ERRORS";
    error.graphqlErrors = payload.errors;
    throw error;
  }

  return payload?.data ?? null;
}
