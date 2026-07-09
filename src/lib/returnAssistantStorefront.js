import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/rateLimit";
import { normalizeShopDomain } from "@/lib/shopifyAppProxy";

export const RETURN_ASSISTANT_PROXY_MAX_BODY_BYTES = 1024;

export const RETURN_ASSISTANT_EVENT_NAMES = [
  "launcher_opened",
  "launcher_closed",
  "inline_viewed",
];

export const RETURN_ASSISTANT_PROXY_ERROR_CODES = {
  MERCHANT_UNAVAILABLE: "RETURN_ASSISTANT_MERCHANT_UNAVAILABLE",
  PAYLOAD_TOO_LARGE: "RETURN_ASSISTANT_PAYLOAD_TOO_LARGE",
  INVALID_JSON: "RETURN_ASSISTANT_INVALID_JSON",
  INVALID_EVENT: "RETURN_ASSISTANT_INVALID_EVENT",
};

export const returnAssistantEventSchema = z.object({
  event: z.enum(["launcher_opened", "launcher_closed", "inline_viewed"]),
  mode: z.enum(["inline", "floating"]).optional(),
  timestamp: z
    .string()
    .trim()
    .max(64)
    .refine((value) => !/[\r\n]/.test(value), {
      message: "Timestamp must not contain newline characters.",
    })
    .optional(),
});

const ACTIVE_MERCHANT_SELECT = {
  id: true,
  shopDomain: true,
  isActive: true,
  shopifyInstalledAt: true,
  shopifyUninstalledAt: true,
};

/**
 * @param {string} shopDomain
 */
export function buildReturnAssistantBootstrap(shopDomain) {
  const shop = normalizeShopDomain(shopDomain);

  return {
    ok: true,
    enabled: true,
    mode: "return-assistant",
    shop,
    copy: {
      title: "Return Assistant",
      greeting: "We'll help you start your return.",
    },
    features: {
      chatUi: false,
      orderVerification: false,
      productSelection: false,
      imageUpload: false,
      dynamicFollowUps: false,
      aiOfferPresentation: false,
    },
  };
}

/**
 * Resolve an installed, active merchant for storefront app proxy traffic.
 * Never selects access tokens or other secrets.
 *
 * @param {string} shopDomain
 */
export async function resolveReturnAssistantMerchant(shopDomain) {
  const normalizedShop = normalizeShopDomain(shopDomain);
  if (!normalizedShop) {
    return null;
  }

  const merchant = await prisma.merchant.findFirst({
    where: {
      shopDomain: {
        equals: normalizedShop,
        mode: "insensitive",
      },
      isActive: true,
      shopifyInstalledAt: { not: null },
      shopifyUninstalledAt: null,
    },
    select: ACTIVE_MERCHANT_SELECT,
  });

  if (!merchant) {
    return null;
  }

  return {
    id: merchant.id,
    shopDomain: normalizeShopDomain(merchant.shopDomain) ?? normalizedShop,
    isActive: merchant.isActive,
  };
}

/**
 * @param {string} shopDomain
 * @param {Request} request
 */
export function buildReturnAssistantProxyRateLimitKey(shopDomain, request) {
  const shop = normalizeShopDomain(shopDomain) ?? "unknown-shop";
  const ip = getClientIp(request);
  return `return-assistant-proxy:${shop}:${ip}`;
}

/**
 * @param {string} rawBody
 */
export function parseReturnAssistantEventPayload(rawBody) {
  if (rawBody.length > RETURN_ASSISTANT_PROXY_MAX_BODY_BYTES) {
    return {
      ok: false,
      code: RETURN_ASSISTANT_PROXY_ERROR_CODES.PAYLOAD_TOO_LARGE,
      message: "Payload too large.",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {
      ok: false,
      code: RETURN_ASSISTANT_PROXY_ERROR_CODES.INVALID_JSON,
      message: "Invalid JSON body.",
    };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      code: RETURN_ASSISTANT_PROXY_ERROR_CODES.INVALID_EVENT,
      message: "Invalid event payload.",
    };
  }

  const validated = returnAssistantEventSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      code: RETURN_ASSISTANT_PROXY_ERROR_CODES.INVALID_EVENT,
      message: "Invalid event payload.",
    };
  }

  return {
    ok: true,
    data: validated.data,
  };
}

/**
 * Log only enum-safe storefront event metadata (no arbitrary user strings).
 *
 * @param {{
 *   shop: string;
 *   event: (typeof RETURN_ASSISTANT_EVENT_NAMES)[number];
 *   mode?: "inline" | "floating";
 * }} context
 */
export function logReturnAssistantProxyEvent(context) {
  console.info("[ReturnAssistant:proxy:event]", {
    shop: context.shop,
    event: context.event,
    mode: context.mode ?? null,
  });
}
