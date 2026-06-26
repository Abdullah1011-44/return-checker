import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_AUDIT_ACTORS,
  ADMIN_AUDIT_EVENTS,
  ADMIN_AUDIT_SEVERITY,
  safeCreateAdminAuditLog,
} from "@/lib/adminAudit";
import { AUDIT_EVENTS, logAuditInfo } from "@/lib/audit";
import { createMerchantSession } from "@/lib/auth";
import { isDevelopment, isMissingEnvError } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { captureException } from "@/lib/sentry";
import {
  exchangeAuthorizationCode,
  getShopifyEnv,
  SHOPIFY_OAUTH_STATE_COOKIE,
  upsertMerchantFromOAuth,
  validateShopDomain,
  verifyShopifyOAuthCallback,
} from "@/lib/shopifyOAuth";
import { registerShopifyWebhooks } from "@/lib/shopifyWebhooks";

async function registerWebhooksAfterInstall({
  merchant,
  shopDomain,
  accessToken,
}) {
  let webhookResult = {
    success: false,
    registered: [],
    skipped: [],
    failed: [],
  };

  try {
    webhookResult = await registerShopifyWebhooks({
      shopDomain,
      accessToken,
    });
  } catch (error) {
    console.warn("[GET /api/auth/callback] Webhook registration failed", {
      shopDomain,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    webhookResult.failed.push({
      reason: "Webhook registration threw unexpectedly",
    });
  }

  if (!webhookResult.success) {
    console.warn(
      "[GET /api/auth/callback] Shopify webhook registration completed with failures",
      {
        shopDomain,
        registeredCount: webhookResult.registered.length,
        skippedCount: webhookResult.skipped.length,
        failedCount: webhookResult.failed.length,
      },
    );
  }

  if (!merchant?.id) {
    return webhookResult;
  }

  const auditMetadata = {
    shopDomain,
    registeredCount: webhookResult.registered.length,
    skippedCount: webhookResult.skipped.length,
    failedCount: webhookResult.failed.length,
  };

  logAuditInfo(AUDIT_EVENTS.WEBHOOKS_REGISTERED, auditMetadata);

  await safeCreateAdminAuditLog({
    merchantId: merchant.id,
    actorType: ADMIN_AUDIT_ACTORS.SYSTEM,
    severity: webhookResult.success
      ? ADMIN_AUDIT_SEVERITY.INFO
      : ADMIN_AUDIT_SEVERITY.WARN,
    eventType: ADMIN_AUDIT_EVENTS.WEBHOOKS_REGISTERED,
    resourceType: "SHOPIFY_WEBHOOK",
    message: webhookResult.success
      ? "Shopify webhooks registered after OAuth install"
      : "Shopify webhook registration completed with failures",
    metadata: auditMetadata,
  });

  return webhookResult;
}

/**
 * GET /api/auth/callback
 *
 * Shopify OAuth callback:
 * 1. Validate query params (shop, code, state, hmac)
 * 2. Verify CSRF state cookie
 * 3. Verify HMAC via @shopify/shopify-api
 * 4. Exchange code for access token (server-side only)
 * 5. Upsert Merchant in Prisma
 * 6. Register Shopify webhooks (non-blocking)
 * 7. Create merchant session → clear state cookie → redirect to /dashboard
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
        { status: 400 },
      );
    }

    const shopCheck = validateShopDomain(shopParam);
    if (!shopCheck.valid) {
      return NextResponse.json(
        { success: false, message: shopCheck.error },
        { status: 400 },
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
        { status: 401 },
      );
    }

    if (storedState !== state) {
      return NextResponse.json(
        { success: false, message: "Invalid OAuth state. Please try again." },
        { status: 401 },
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
        { status: 401 },
      );
    }

    const { accessToken, scope } = await exchangeAuthorizationCode(
      shopCheck.shop,
      code,
    );

    const merchant = await upsertMerchantFromOAuth(
      prisma,
      shopCheck.shop,
      accessToken,
      scope,
    );

    await registerWebhooksAfterInstall({
      merchant,
      shopDomain: shopCheck.shop,
      accessToken,
    });

    await createMerchantSession(merchant);

    cookieStore.delete(SHOPIFY_OAUTH_STATE_COOKIE);

    const dashboardUrl = new URL("/dashboard", appUrl);
    return NextResponse.redirect(dashboardUrl);
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: null,
      shopDomain: request.nextUrl.searchParams.get("shop") || null,
      action: "shopify_oauth_callback",
    });

    console.error("[GET /api/auth/callback]", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    if (isMissingEnvError(error)) {
      if (isDevelopment()) {
        console.error("[GET /api/auth/callback] config:", error.message);
      }
      return NextResponse.json(
        { success: false, message: "Server configuration error" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Shopify installation failed. Please try again.",
      },
      { status: 500 },
    );
  }
}
