import { vi } from "vitest";

/**
 * Prisma delegate mock with common CRUD/query methods.
 * @returns {Record<string, import("vitest").Mock>}
 */
function createModelMock() {
  return {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    aggregate: vi.fn(),
  };
}

/**
 * Build a fresh mocked Prisma client (no database connection).
 * @returns {object}
 */
export function createMockPrisma() {
  const mock = {
    merchant: createModelMock(),
    merchantUser: createModelMock(),
    customerOrder: createModelMock(),
    orderItem: createModelMock(),
    returnRequest: createModelMock(),
    returnItem: createModelMock(),
    returnEvent: createModelMock(),
    adminAuditLog: createModelMock(),
    merchantSettings: createModelMock(),
    shopifyProduct: createModelMock(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };

  mock.$transaction.mockImplementation(async (callback) => callback(mock));

  return mock;
}

/** Shared Prisma mock used by tests/setup.js for @/lib/prisma. */
export const mockPrisma = createMockPrisma();

/**
 * Reset all mock implementations between tests.
 * @param {ReturnType<typeof createMockPrisma>} [prisma]
 */
export function resetMockPrisma(prisma = mockPrisma) {
  for (const [key, value] of Object.entries(prisma)) {
    if (key.startsWith("$")) {
      if (typeof value?.mockReset === "function") {
        value.mockReset();
      }
      continue;
    }

    if (value && typeof value === "object") {
      for (const method of Object.values(value)) {
        if (typeof method?.mockReset === "function") {
          method.mockReset();
        }
      }
    }
  }

  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
}
