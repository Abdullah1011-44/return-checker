/**
 * Default merchant fields aligned with auth session select + admin checks.
 * @param {Record<string, unknown>} [overrides]
 * @returns {{
 *   id: string;
 *   shopDomain: string;
 *   shopName: string;
 *   email: string;
 *   role: string;
 *   isActive: boolean;
 *   shopifyInstalledAt: Date;
 * }}
 */
export function createMockMerchant(overrides = {}) {
  return {
    id: "merchant-test-1",
    shopDomain: "test-store.myshopify.com",
    shopName: "Test Store",
    email: "merchant@test.com",
    role: "MERCHANT",
    isActive: true,
    shopifyInstalledAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Merchant with platform ADMIN role.
 * @param {Record<string, unknown>} [overrides]
 */
export function createMockAdminMerchant(overrides = {}) {
  return createMockMerchant({
    id: "merchant-admin-1",
    email: "admin@test.com",
    role: "ADMIN",
    ...overrides,
  });
}

/** Merchant A fixture for isolation tests. */
export function createMockMerchantA(overrides = {}) {
  return createMockMerchant({ id: "merchant-a", ...overrides });
}

/** Merchant B fixture for isolation tests. */
export function createMockMerchantB(overrides = {}) {
  return createMockMerchant({
    id: "merchant-b",
    shopDomain: "merchant-b.myshopify.com",
    email: "merchant-b@test.com",
    ...overrides,
  });
}

/** Return request row fixture. */
export function createMockReturnRequest(overrides = {}) {
  return {
    id: "return-request-1",
    merchantId: "merchant-a",
    orderId: "order-1",
    customerEmail: "customer@test.com",
    status: "PENDING",
    ...overrides,
  };
}

/**
 * Mirrors dashboard/API where clause: scoped by merchant + request id.
 * @param {{ id?: string } | null | undefined} merchant
 * @param {string} returnRequestId
 */
export function buildScopedReturnRequestWhere(merchant, returnRequestId) {
  if (!merchant?.id) {
    return null;
  }

  return {
    id: returnRequestId,
    merchantId: merchant.id,
  };
}

/**
 * Mirrors GET /api/requests merchant-scoped listing.
 * @param {{ id?: string } | null | undefined} merchant
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function listReturnRequestsForMerchant(merchant, prismaClient) {
  if (!merchant?.id) {
    return { error: "MERCHANT_REQUIRED", requests: [] };
  }

  const requests = await prismaClient.returnRequest.findMany({
    where: { merchantId: merchant.id },
  });

  return { requests };
}

/**
 * Mirrors PATCH /api/update-request lookup: merchant cannot load another tenant's row.
 * @param {{ id?: string } | null | undefined} merchant
 * @param {string} returnRequestId
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function findReturnRequestForMerchant(
  merchant,
  returnRequestId,
  prismaClient
) {
  const where = buildScopedReturnRequestWhere(merchant, returnRequestId);

  if (!where) {
    return { error: "MERCHANT_REQUIRED", request: null };
  }

  const request = await prismaClient.returnRequest.findFirst({ where });

  return { request };
}
