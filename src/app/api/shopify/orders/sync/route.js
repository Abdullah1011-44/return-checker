import { NextResponse } from "next/server";
import { requireMerchantForRoute } from "@/lib/merchantApi";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { syncShopifyOrders } from "@/lib/syncShopifyOrders";

/**
 * Sync Shopify orders for the authenticated merchant only.
 * Request body is intentionally ignored — never pass merchantId from the client.
 */
export async function POST(request) {
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
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { merchant } = auth;
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
    console.error("[POST /api/shopify/orders/sync]", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    if (
      error?.code === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED" ||
      error?.message === "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED"
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "SHOPIFY_PROTECTED_CUSTOMER_DATA_REQUIRED",
          error:
            "Shopify connection works, but order sync requires protected customer data access approval in Shopify Partner Dashboard.",
          nextStep:
            "Go to Shopify Partner Dashboard > App > API access > Protected customer data access, request access, make sure read_orders is included, then reinstall the app.",
        },
        { status: 403 }
      );
    }

    const payload = {
      success: false,
      error: "Unable to sync Shopify orders",
    };

    if (process.env.NODE_ENV !== "production" && error instanceof Error) {
      payload.debug = error.message;
    }

    return NextResponse.json(payload, { status: 500 });
  }
}
