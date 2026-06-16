import { beforeEach, vi } from "vitest";
import { mockPrisma, resetMockPrisma } from "./helpers/mockPrisma.js";

/** Prevent accidental use of a real database URL during tests. */
process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/return_checker_test_no_connect";
process.env.DIRECT_URL = process.env.DATABASE_URL;

vi.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

beforeEach(() => {
  resetMockPrisma(mockPrisma);
});
