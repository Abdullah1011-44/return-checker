import crypto from "node:crypto";
import { MERCHANT_SESSION_COOKIE } from "@/lib/merchantSessionConstants";

export { MERCHANT_SESSION_COOKIE };

/** 7 days */
export const MERCHANT_SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function getSessionSecret() {
  const secret =
    process.env.MERCHANT_SESSION_SECRET?.trim() ||
    process.env.SHOPIFY_API_SECRET?.trim();

  if (!secret) {
    throw new Error(
      "Missing session secret. Set MERCHANT_SESSION_SECRET or SHOPIFY_API_SECRET.",
    );
  }

  return secret;
}

/**
 * Signed session token: base64url(payload).hmac
 * Payload: { merchantId, shopDomain }
 */
export function encodeMerchantSessionToken({ merchantId, shopDomain }) {
  const secret = getSessionSecret();
  const payload = JSON.stringify({ merchantId, shopDomain });
  const data = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(data)
    .digest("base64url");

  return `${data}.${signature}`;
}

/** Verify signature and parse session payload (no DB lookup). */
export function decodeMerchantSessionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [data, signature] = parts;
  if (!data || !signature) {
    return null;
  }

  try {
    const secret = getSessionSecret();
    const expected = crypto
      .createHmac("sha256", secret)
      .update(data)
      .digest("base64url");

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));

    if (!payload?.merchantId || !payload?.shopDomain) {
      return null;
    }

    return {
      merchantId: payload.merchantId,
      shopDomain: payload.shopDomain,
    };
  } catch {
    return null;
  }
}

export function merchantSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MERCHANT_SESSION_MAX_AGE,
  };
}
