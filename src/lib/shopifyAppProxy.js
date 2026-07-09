import crypto from "node:crypto";
import { requireEnv } from "@/lib/env";
import { validateShopDomain } from "@/lib/shopifyOAuth";

export const APP_PROXY_SIGNATURE_PARAM = "signature";

export const APP_PROXY_ERROR_CODES = {
  INVALID_REQUEST: "APP_PROXY_INVALID_REQUEST",
  SIGNATURE_MISSING: "APP_PROXY_SIGNATURE_MISSING",
  SIGNATURE_INVALID: "APP_PROXY_SIGNATURE_INVALID",
  SHOP_MISSING: "APP_PROXY_SHOP_MISSING",
  SHOP_INVALID: "APP_PROXY_SHOP_INVALID",
  TIMESTAMP_MISSING: "APP_PROXY_TIMESTAMP_MISSING",
  TIMESTAMP_INVALID: "APP_PROXY_TIMESTAMP_INVALID",
  TIMESTAMP_EXPIRED: "APP_PROXY_TIMESTAMP_EXPIRED",
  CONFIG_ERROR: "APP_PROXY_CONFIG_ERROR",
};

const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
const DEFAULT_MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

/**
 * @param {unknown} shop
 */
export function normalizeShopDomain(shop) {
  if (!shop || typeof shop !== "string") {
    return null;
  }

  return shop.trim().toLowerCase();
}

/**
 * @param {unknown} shop
 */
export function isValidShopDomain(shop) {
  const normalized = normalizeShopDomain(shop);
  if (!normalized || !SHOP_DOMAIN_PATTERN.test(normalized)) {
    return false;
  }

  return validateShopDomain(normalized).valid;
}

/**
 * @param {unknown} left
 * @param {unknown} right
 */
export function safeTimingEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Build the canonical app proxy signing payload from flat query params.
 * Duplicate values must already be comma-joined in each param value.
 *
 * @param {Record<string, string>} params
 */
export function buildProxySignaturePayload(params) {
  return Object.entries(params)
    .filter(([key]) => key !== APP_PROXY_SIGNATURE_PARAM)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("");
}

/**
 * @param {URLSearchParams} searchParams
 */
function collectAppProxyQueryParams(searchParams) {
  /** @type {Map<string, string[]>} */
  const grouped = new Map();

  for (const [key, value] of searchParams.entries()) {
    const existing = grouped.get(key);
    if (existing) {
      existing.push(value);
      continue;
    }

    grouped.set(key, [value]);
  }

  /** @type {Record<string, string>} */
  const params = {};

  for (const [key, values] of grouped.entries()) {
    params[key] = values.join(",");
  }

  return params;
}

/**
 * @param {unknown} timestamp
 */
function parseAppProxyTimestampMs(timestamp) {
  const raw = String(timestamp ?? "").trim();
  if (!raw) {
    return null;
  }

  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber)) {
    return null;
  }

  if (raw.includes(".")) {
    return Math.floor(asNumber * 1000);
  }

  if (asNumber < 1_000_000_000_000) {
    return Math.floor(asNumber * 1000);
  }

  return Math.floor(asNumber);
}

function resolveRequestUrl(requestOrUrl) {
  if (typeof requestOrUrl === "string") {
    return new URL(requestOrUrl, "https://app-proxy.local");
  }

  if (requestOrUrl && typeof requestOrUrl.url === "string") {
    return new URL(requestOrUrl.url);
  }

  return null;
}

function buildFailure(status, code, message) {
  return {
    ok: false,
    status,
    code,
    message,
  };
}

function computeProxySignatureHex(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
}

/**
 * Verify a Shopify app proxy request by signature, shop, and timestamp.
 * Never returns secrets or raw tokens in the result payload.
 *
 * @param {Request | string} requestOrUrl
 * @param {{ now?: number; maxAgeMs?: number }} [options]
 */
export function verifyShopifyAppProxyRequest(requestOrUrl, options = {}) {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_TIMESTAMP_AGE_MS;

  const url = resolveRequestUrl(requestOrUrl);
  if (!url) {
    return buildFailure(
      400,
      APP_PROXY_ERROR_CODES.INVALID_REQUEST,
      "Invalid app proxy request.",
    );
  }

  const params = collectAppProxyQueryParams(url.searchParams);
  const signature = params[APP_PROXY_SIGNATURE_PARAM];

  if (!signature) {
    return buildFailure(
      401,
      APP_PROXY_ERROR_CODES.SIGNATURE_MISSING,
      "Missing app proxy signature.",
    );
  }

  const shop = params.shop;
  if (!shop) {
    return buildFailure(
      400,
      APP_PROXY_ERROR_CODES.SHOP_MISSING,
      "Missing shop parameter.",
    );
  }

  const timestamp = params.timestamp;
  if (!timestamp) {
    return buildFailure(
      400,
      APP_PROXY_ERROR_CODES.TIMESTAMP_MISSING,
      "Missing timestamp parameter.",
    );
  }

  const normalizedShop = normalizeShopDomain(shop);
  if (!isValidShopDomain(normalizedShop)) {
    return buildFailure(
      400,
      APP_PROXY_ERROR_CODES.SHOP_INVALID,
      "Invalid shop domain.",
    );
  }

  const timestampMs = parseAppProxyTimestampMs(timestamp);
  if (timestampMs === null) {
    return buildFailure(
      400,
      APP_PROXY_ERROR_CODES.TIMESTAMP_INVALID,
      "Invalid timestamp parameter.",
    );
  }

  if (now - timestampMs > maxAgeMs) {
    return buildFailure(
      401,
      APP_PROXY_ERROR_CODES.TIMESTAMP_EXPIRED,
      "App proxy timestamp expired.",
    );
  }

  let secret;
  try {
    secret = requireEnv("SHOPIFY_API_SECRET");
  } catch {
    return buildFailure(
      500,
      APP_PROXY_ERROR_CODES.CONFIG_ERROR,
      "Server configuration error.",
    );
  }

  const payload = buildProxySignaturePayload(params);
  const expectedSignature = computeProxySignatureHex(payload, secret);

  if (!safeTimingEqual(expectedSignature, signature)) {
    return buildFailure(
      401,
      APP_PROXY_ERROR_CODES.SIGNATURE_INVALID,
      "Invalid app proxy signature.",
    );
  }

  return {
    ok: true,
    shop: normalizedShop,
    path: url.pathname,
    params,
  };
}
