import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  exchangeAuthorizationCode,
  getShopifyEnv,
  SHOPIFY_OAUTH_STATE_COOKIE,
  upsertMerchantFromOAuth,
  validateShopDomain,
  verifyShopifyOAuthCallback,
} from "@/lib/shopifyOAuth";

/**
 * GET /api/auth/callback
 *
 * Shopify OAuth callback:
 * 1. Validate query params (shop, code, state, hmac)
 * 2. Verify CSRF state cookie
 * 3. Verify HMAC via @shopify/shopify-api
 * 4. Exchange code for access token (server-side only)
 * 5. Upsert Merchant in Prisma
 * 6. Clear state cookie → redirect to /dashboard
 */
export async function GET(request) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const shopParam = searchParams.get("shop");
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const hmac = searchParams.get("hmac");

    if (!shopParam || !code || !state || !hmac) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Missing required OAuth parameters (shop, code, state, or hmac).",
        },
        { status: 400 }
      );
    }

    const shopCheck = validateShopDomain(shopParam);
    if (!shopCheck.valid) {
      return NextResponse.json(
        { success: false, message: shopCheck.error },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const storedState = cookieStore.get(SHOPIFY_OAUTH_STATE_COOKIE)?.value;

    if (!storedState) {
      return NextResponse.json(
        {
          success: false,
          message: "OAuth session expired. Please install the app again.",
        },
        { status: 401 }
      );
    }

    if (storedState !== state) {
      return NextResponse.json(
        { success: false, message: "Invalid OAuth state. Please try again." },
        { status: 401 }
      );
    }

    const { appUrl } = getShopifyEnv();

    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    console.log("OAuth query keys:", Object.keys(query));

    const hmacCheck = await verifyShopifyOAuthCallback(query);
    if (!hmacCheck.valid) {
      const isDev = process.env.NODE_ENV === "development";
      return NextResponse.json(
        {
          success: false,
          message: hmacCheck.error,
          ...(isDev && hmacCheck.debug ? { debug: hmacCheck.debug } : {}),
        },
        { status: 401 }
      );
    }

    const { accessToken, scope } = await exchangeAuthorizationCode(
      shopCheck.shop,
      code
    );

    await upsertMerchantFromOAuth(
      prisma,
      shopCheck.shop,
      accessToken,
      scope
    );

    cookieStore.delete(SHOPIFY_OAUTH_STATE_COOKIE);

    const dashboardUrl = new URL("/dashboard", appUrl);
    return NextResponse.redirect(dashboardUrl);
  } catch (error) {
    console.error("[GET /api/auth/callback]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Shopify installation failed. Please try again.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
