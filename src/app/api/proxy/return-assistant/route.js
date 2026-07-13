import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/errors";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import {
  buildReturnAssistantBootstrap,
  buildReturnAssistantProxyRateLimitKey,
  logReturnAssistantProxyEvent,
  parseReturnAssistantEventPayload,
  RETURN_ASSISTANT_PROXY_ERROR_CODES,
  resolveReturnAssistantMerchant,
} from "@/lib/returnAssistantStorefront";
import { captureException } from "@/lib/sentry";
import {
  APP_PROXY_ERROR_CODES,
  verifyShopifyAppProxyRequest,
} from "@/lib/shopifyAppProxy";

const PROXY_ROUTE_NAME = "return-assistant-proxy";
const PROXY_RATE_LIMIT = 60;
const PROXY_RATE_WINDOW_MS = 60 * 1000;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

function proxyJsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

/**
 * Shopify App Proxy must receive a direct 200 JSON response.
 * Never redirect — relative Location headers resolve on the shop domain and 404.
 */
function assertNoRedirect(response) {
  if (response.status >= 300 && response.status < 400) {
    return proxyJsonResponse(
      {
        ok: false,
        code: "RETURN_ASSISTANT_PROXY_ERROR",
        message: "Unable to load return assistant.",
      },
      500,
    );
  }

  response.headers.delete("Location");
  return response;
}

function mapProxyVerificationStatus(code, defaultStatus) {
  if (
    code === APP_PROXY_ERROR_CODES.SIGNATURE_MISSING ||
    code === APP_PROXY_ERROR_CODES.SIGNATURE_INVALID ||
    code === APP_PROXY_ERROR_CODES.TIMESTAMP_EXPIRED ||
    code === APP_PROXY_ERROR_CODES.SHOP_MISSING
  ) {
    return 401;
  }

  return defaultStatus;
}

async function authenticateReturnAssistantProxy(request) {
  const verification = verifyShopifyAppProxyRequest(request);
  if (!verification.ok) {
    return {
      ok: false,
      response: proxyJsonResponse(
        {
          ok: false,
          code: verification.code,
          message: verification.message,
        },
        mapProxyVerificationStatus(verification.code, verification.status),
      ),
    };
  }

  const rateLimitResult = rateLimit({
    key: buildReturnAssistantProxyRateLimitKey(verification.shop, request),
    limit: PROXY_RATE_LIMIT,
    windowMs: PROXY_RATE_WINDOW_MS,
  });

  if (!rateLimitResult.allowed) {
    const limited = rateLimitResponse(rateLimitResult);
    limited.headers.set("Cache-Control", "no-store");
    return {
      ok: false,
      response: limited,
    };
  }

  const merchant = await resolveReturnAssistantMerchant(verification.shop);
  if (!merchant) {
    return {
      ok: false,
      response: proxyJsonResponse(
        {
          ok: false,
          code: RETURN_ASSISTANT_PROXY_ERROR_CODES.MERCHANT_UNAVAILABLE,
          message: "Store unavailable.",
        },
        403,
      ),
    };
  }

  return {
    ok: true,
    shop: verification.shop,
    merchant,
  };
}

export async function GET(request) {
  try {
    const auth = await authenticateReturnAssistantProxy(request);
    if (!auth.ok) {
      return assertNoRedirect(auth.response);
    }

    return assertNoRedirect(
      proxyJsonResponse(buildReturnAssistantBootstrap(auth.shop)),
    );
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      action: PROXY_ROUTE_NAME,
    });

    return assertNoRedirect(
      handleApiError(error, {
        context: PROXY_ROUTE_NAME,
        fallbackMessage: "Unable to load return assistant.",
        fallbackCode: "RETURN_ASSISTANT_PROXY_ERROR",
      }),
    );
  }
}

export async function POST(request) {
  try {
    const auth = await authenticateReturnAssistantProxy(request);
    if (!auth.ok) {
      return auth.response;
    }

    const rawBody = await request.text();
    const parsed = parseReturnAssistantEventPayload(rawBody);

    if (!parsed.ok) {
      return proxyJsonResponse(
        {
          ok: false,
          code: parsed.code,
          message: parsed.message,
        },
        400,
      );
    }

    logReturnAssistantProxyEvent({
      shop: auth.shop,
      event: parsed.data.event,
      mode: parsed.data.mode,
    });

    return proxyJsonResponse({ ok: true });
  } catch (error) {
    captureException(error, {
      route: request?.url,
      method: request?.method,
      action: PROXY_ROUTE_NAME,
    });

    return handleApiError(error, {
      context: PROXY_ROUTE_NAME,
      fallbackMessage: "Unable to process return assistant event.",
      fallbackCode: "RETURN_ASSISTANT_PROXY_ERROR",
    });
  }
}
