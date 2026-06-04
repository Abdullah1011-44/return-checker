import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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
    console.error("[GET /api/auth/install]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Unable to start Shopify installation.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
