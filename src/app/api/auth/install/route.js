import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isDevelopment, isMissingEnvError } from "@/lib/env";
import { captureException } from "@/lib/sentry";
import {
  buildAuthorizeUrl,
  generateOAuthState,
  getOAuthRedirectUri,
  getShopifyEnv,
  oauthStateCookieOptions,
  SHOPIFY_OAUTH_STATE_COOKIE,
  validateShopDomain,
} from "@/lib/shopifyOAuth";

/**
 * GET /api/auth/install?shop=STORE.myshopify.com
 *
 * Starts Shopify OAuth:
 * 1. Validate shop domain
 * 2. Generate CSRF state → httpOnly cookie
 * 3. Redirect merchant to Shopify authorize URL
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopParam = searchParams.get("shop");

    const shopCheck = validateShopDomain(shopParam);
    if (!shopCheck.valid) {
      return NextResponse.json(
        { success: false, message: shopCheck.error },
        { status: 400 }
      );
    }

    const { apiKey, scopes, appUrl } = getShopifyEnv();
    const redirectUri = getOAuthRedirectUri(appUrl);
    const state = generateOAuthState();

    const cookieStore = await cookies();
    cookieStore.set(SHOPIFY_OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());

    const authorizeUrl = buildAuthorizeUrl({
      shop: shopCheck.shop,
      state,
      apiKey,
      scopes,
      redirectUri,
    });

    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: null,
      shopDomain: request.nextUrl.searchParams.get("shop") || null,
      action: "shopify_install",
    });

    console.error("[GET /api/auth/install]", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    if (isMissingEnvError(error)) {
      if (isDevelopment()) {
        console.error("[GET /api/auth/install] config:", error.message);
      }
      return NextResponse.json(
        { success: false, message: "Server configuration error" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: false, message: "Unable to start Shopify installation." },
      { status: 500 }
    );
  }
}
