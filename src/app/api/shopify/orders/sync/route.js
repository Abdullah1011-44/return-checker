import { NextResponse } from "next/server";
import {
  AppError,
  createApiErrorResponse,
  handleApiError,
  logSafeError,
} from "@/lib/errors";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { syncShopifyOrders } from "@/lib/syncShopifyOrders";

function isProtectedCustomerDataError(error) {
  return (
    error?.code === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED" ||
    error?.message === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"
  );
}

function isShopifyNetworkError(error) {
  if (error?.code === "SHOPIFY_NETWORK_ERROR") {
    return true;
  }

  const cause = error?.cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const networkCodes = [
      "ECONNREFUSED",
      "ENOTFOUND",
      "ETIMEDOUT",
      "ECONNRESET",
      "UND_ERR_CONNECT_TIMEOUT",
    ];
    if (networkCodes.includes(cause.code)) {
      return true;
    }
  }

  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

function logShopifySyncError(context, error, meta = {}) {
  console.error("[Shopify Sync]", {
    context,
    shopDomain: meta.shopDomain ?? null,
    endpoint: error?.endpoint ?? meta.endpoint ?? null,
    httpStatus: error?.status ?? null,
    code: error?.code ?? null,
    hasToken: meta.hasToken ?? null,
  });

  logSafeError(context, error);
}

function handleShopifySyncRouteError(error, meta = {}) {
  logShopifySyncError("shopify-order-sync", error, meta);

  if (isProtectedCustomerDataError(error)) {
    return createApiErrorResponse(
      "Shopify connection works, but order sync requires protected customer data access approval in Shopify Partner Dashboard.",
      403,
      "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
      {
        nextStep:
          "Go to Shopify Partner Dashboard > App > API access > Protected customer data access, request access, make sure read_orders is included, then reinstall the app.",
      }
    );
  }

  if (error instanceof AppError) {
    return createApiErrorResponse(error.message, error.status, error.code);
  }

  const httpStatus = error?.status;

  if (httpStatus === 401 || httpStatus === 403) {
    return createApiErrorResponse(
      "Shopify permission required",
      httpStatus,
      "SHOPIFY_PERMISSION_REQUIRED"
    );
  }

  if (httpStatus === 429) {
    return createApiErrorResponse(
      "Shopify rate limit reached. Please try again later.",
      429,
      "SHOPIFY_RATE_LIMIT"
    );
  }

  if (httpStatus === 500 || httpStatus === 502 || httpStatus === 503) {
    return createApiErrorResponse(
      "Shopify is temporarily unavailable. Please try again later.",
      502,
      "SHOPIFY_UNAVAILABLE"
    );
  }

  if (isShopifyNetworkError(error)) {
    return createApiErrorResponse(
      "Unable to connect to Shopify. Please try again.",
      503,
      "SHOPIFY_CONNECTION_ERROR"
    );
  }

  return handleApiError(error, {
    context: "shopify-order-sync",
    fallbackMessage: "Unable to sync Shopify orders. Please try again.",
    fallbackCode: "SHOPIFY_SYNC_ERROR",
  });
}

/**
 * Sync Shopify orders for the authenticated merchant only.
 * Request body is intentionally ignored — never pass merchantId from the client.
 */
export async function POST(request) {
  let merchant = null;

  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: "shopify-order-sync",
      limit: 5,
      windowMs: 5 * 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult);
    }

    const auth = await requireMerchantForRoute();
    if (auth.response) {
      return createApiErrorResponse("Unauthorized", 401, "UNAUTHORIZED");
    }

    merchant = auth.merchant;
    const result = await syncShopifyOrders(merchant.id);

    // TODO: Add merchant-level audit event support for Shopify sync.
    // ReturnEvent requires returnRequestId, so SHOPIFY_ORDER_SYNC cannot be
    // persisted until merchant-scoped audit events exist.

    return NextResponse.json({
      success: true,
      orders: result.orders,
      items: result.items,
      pagesFetched: result.pagesFetched,
    });
  } catch (error) {
    return handleShopifySyncRouteError(error, {
      shopDomain: merchant?.shopDomain,
      hasToken: Boolean(merchant?.shopifyAccessToken),
    });
  }
}
