export const MERCHANT_SESSION_COOKIE = "merchant_session";

/** Basic shape check for middleware (full verify in auth.js). */
export function hasMerchantSessionCookieShape(token) {
  if (!token || typeof token !== "string") {
    return false;
  }

  const parts = token.split(".");
  return parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]);
}
