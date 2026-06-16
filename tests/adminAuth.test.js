import { describe, expect, it } from "vitest";
import { isAdmin, requireAdmin } from "@/lib/adminAuth";

describe("isAdmin", () => {
  it('returns true for { role: "ADMIN" }', () => {
    expect(isAdmin({ role: "ADMIN" })).toBe(true);
  });

  it('returns false for { role: "MERCHANT" }', () => {
    expect(isAdmin({ role: "MERCHANT" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAdmin(null)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("does not throw for ADMIN", () => {
    expect(() => requireAdmin({ role: "ADMIN" })).not.toThrow();
  });

  it('throws "Forbidden" for MERCHANT', () => {
    expect(() => requireAdmin({ role: "MERCHANT" })).toThrow("Forbidden");
  });

  it('throws "Forbidden" for null', () => {
    expect(() => requireAdmin(null)).toThrow("Forbidden");
  });
});
