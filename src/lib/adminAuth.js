/**
 * Returns true when the merchant has the platform ADMIN role.
 * @param {{ role?: string } | null | undefined} merchant
 * @returns {boolean}
 */
export function isAdmin(merchant) {
  return merchant?.role === "ADMIN";
}

/**
 * Require an ADMIN merchant or throw Forbidden.
 * @param {{ role?: string } | null | undefined} merchant
 * @throws {Error} When merchant is not an admin.
 */
export function requireAdmin(merchant) {
  if (!isAdmin(merchant)) {
    throw new Error("Forbidden");
  }
}
