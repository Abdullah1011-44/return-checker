import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetTag, mockWithScope, mockSentryCaptureException } = vi.hoisted(
  () => {
    const mockSetTag = vi.fn();
    const mockSetUser = vi.fn();
    const mockSetContext = vi.fn();
    const mockScope = {
      setTag: mockSetTag,
      setUser: mockSetUser,
      setContext: mockSetContext,
    };
    const mockWithScope = vi.fn((callback) => callback(mockScope));
    const mockSentryCaptureException = vi.fn();

    return {
      mockSetTag,
      mockWithScope,
      mockSentryCaptureException,
    };
  },
);

vi.mock("@sentry/nextjs", () => ({
  withScope: mockWithScope,
  captureException: mockSentryCaptureException,
}));

vi.mock("@/lib/audit", () => ({
  sanitizeAuditMetadata: (metadata) => metadata ?? {},
}));

import { captureException } from "@/lib/sentry";

const testContext = {
  merchantId: "merchant-1",
  shopDomain: "demo.myshopify.com",
  route: "http://localhost:3000/api/test",
  method: "POST",
  action: "sentry_test",
};

describe("captureException", () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
  });

  it("does not throw when SENTRY_DSN is missing", () => {
    expect(() => {
      captureException(new Error("missing dsn"));
    }).not.toThrow();
  });

  it("falls back to console.error when SENTRY_DSN is missing", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const error = new Error("fallback test");
    captureException(error, testContext);

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[Error]",
      expect.objectContaining({
        name: "Error",
        message: "fallback test",
        merchantId: testContext.merchantId,
        shopDomain: testContext.shopDomain,
        route: testContext.route,
        method: testContext.method,
        action: testContext.action,
      }),
    );
    expect(mockWithScope).not.toHaveBeenCalled();
    expect(mockSentryCaptureException).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("accepts merchantId, shopDomain, route, method, and action context", () => {
    process.env.SENTRY_DSN = "https://test@test.ingest.sentry.io/123";

    captureException(new Error("context test"), testContext);

    expect(mockWithScope).toHaveBeenCalledOnce();
    expect(mockSetTag).toHaveBeenCalledWith(
      "merchantId",
      testContext.merchantId,
    );
    expect(mockSetTag).toHaveBeenCalledWith(
      "shopDomain",
      testContext.shopDomain,
    );
    expect(mockSetTag).toHaveBeenCalledWith("route", testContext.route);
    expect(mockSetTag).toHaveBeenCalledWith("method", testContext.method);
    expect(mockSetTag).toHaveBeenCalledWith("action", testContext.action);
    expect(mockSentryCaptureException).toHaveBeenCalledOnce();
    expect(mockSentryCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "context test" }),
    );
  });
});
