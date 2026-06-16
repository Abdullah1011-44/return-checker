import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  decodeMerchantSessionToken,
  encodeMerchantSessionToken,
  MERCHANT_SESSION_COOKIE,
  merchantSessionCookieOptions,
} from "@/lib/merchantSession";

const MERCHANT_SELECT = {
  id: true,
  shopDomain: true,
  shopName: true,
  email: true,
  role: true,
  isActive: true,
  shopifyInstalledAt: true,
};

/**
 * Create httpOnly merchant session after OAuth install.
 * Stores merchantId + shopDomain only (never access token).
 */
export async function createMerchantSession(merchant) {
  if (!merchant?.id || !merchant?.shopDomain) {
    throw new Error("Cannot create merchant session without id and shopDomain.");
  }

  const token = encodeMerchantSessionToken({
    merchantId: merchant.id,
    shopDomain: merchant.shopDomain,
  });

  const cookieStore = await cookies();
  cookieStore.set(
    MERCHANT_SESSION_COOKIE,
    token,
    merchantSessionCookieOptions()
  );
}

/** Read session cookie and load active merchant from Prisma. */
export async function getCurrentMerchant() {
  const cookieStore = await cookies();
  const token = cookieStore.get(MERCHANT_SESSION_COOKIE)?.value;
  const session = decodeMerchantSessionToken(token);

  if (!session) {
    return null;
  }

  return prisma.merchant.findFirst({
    where: {
      id: session.merchantId,
      shopDomain: session.shopDomain,
      isActive: true,
    },
    select: MERCHANT_SELECT,
  });
}

/** Clear merchant session cookie. */
export async function destroyMerchantSession() {
  const cookieStore = await cookies();
  cookieStore.delete(MERCHANT_SESSION_COOKIE);
}

/** Require authenticated merchant or throw Unauthorized. */
export async function requireMerchant() {
  const merchant = await getCurrentMerchant();

  if (!merchant) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }

  return merchant;
}
