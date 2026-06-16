import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrisma } from "./helpers/mockPrisma.js";

const mockGetCurrentMerchant = vi.fn();
const mockResolveMerchantForCustomerFlow = vi.fn();
const mockFindCustomerOrderForReturn = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentMerchant: (...args) => mockGetCurrentMerchant(...args),
}));

vi.mock("@/lib/orderLookup", () => ({
  resolveMerchantForCustomerFlow: (...args) =>
    mockResolveMerchantForCustomerFlow(...args),
  findCustomerOrderForReturn: (...args) =>
    mockFindCustomerOrderForReturn(...args),
  buildOrderCheckApiResponse: vi.fn(),
  orderNotFoundMessage: vi.fn((merchant) =>
    merchant
      ? "Order not found for your store."
      : "Order not found. Please check your order number and email."
  ),
}));

vi.mock("@/lib/sentry", () => ({
  captureException: (...args) => mockCaptureException(...args),
}));

import { GET as adminTestGet } from "@/app/api/admin/test/route";
import { POST as checkReturnPost } from "@/app/api/check-return/route";
import { POST as returnStatusPost } from "@/app/api/return-status/route";

function jsonRequest(url, body) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function expectNoStackTrace(text) {
  expect(text).not.toMatch(/at\s+\S+\s+\(/);
  expect(text.toLowerCase()).not.toContain("stacktrace");
}

describe("API route smoke tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentMerchant.mockResolvedValue(null);
    mockResolveMerchantForCustomerFlow.mockResolvedValue(null);
    mockFindCustomerOrderForReturn.mockResolvedValue(null);
  });

  it("GET /api/admin/test returns Unauthorized when no merchant session exists", async () => {
    const response = await adminTestGet();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mockGetCurrentMerchant).toHaveBeenCalledOnce();
  });

  it("important public APIs do not expose stack traces", async () => {
    const internalError = new Error("shpat_secret_token should not leak");
    internalError.stack =
      "Error: shpat_secret_token should not leak\n    at SecretModule (secret.js:99:11)";

    mockResolveMerchantForCustomerFlow.mockRejectedValue(internalError);

    const checkReturnResponse = await checkReturnPost(
      jsonRequest("http://localhost:3000/api/check-return", {
        orderNumber: "1001",
        email: "test1@gmail.com",
      })
    );
    const checkReturnText = await checkReturnResponse.text();
    const checkReturnBody = JSON.parse(checkReturnText);

    expect(checkReturnResponse.status).toBe(500);
    expect(checkReturnBody).toEqual({
      success: false,
      error: "Unable to check return eligibility. Please try again.",
      code: "CHECK_RETURN_ERROR",
    });
    expectNoStackTrace(checkReturnText);
    expect(checkReturnText).not.toContain("shpat_secret_token");

    mockPrisma.returnRequest.findFirst.mockRejectedValue(internalError);

    const returnStatusResponse = await returnStatusPost(
      jsonRequest("http://localhost:3000/api/return-status", {
        orderNumber: "1001",
        email: "test1@gmail.com",
      })
    );
    const returnStatusText = await returnStatusResponse.text();
    const returnStatusBody = JSON.parse(returnStatusText);

    expect(returnStatusResponse.status).toBe(500);
    expect(returnStatusBody).toEqual({
      success: false,
      found: false,
      message: "Unable to look up return status. Please try again.",
    });
    expectNoStackTrace(returnStatusText);
    expect(returnStatusText).not.toContain("shpat_secret_token");
  });

  it("invalid request bodies return safe JSON errors", async () => {
    const missingFieldResponse = await checkReturnPost(
      jsonRequest("http://localhost:3000/api/check-return", {
        orderNumber: "1001",
      })
    );
    const missingFieldBody = await missingFieldResponse.json();

    expect(missingFieldResponse.status).toBe(400);
    expect(missingFieldBody.success).toBe(false);
    expect(missingFieldBody.error).toBe("Invalid request");
    expect(Array.isArray(missingFieldBody.details)).toBe(true);
    expectNoStackTrace(JSON.stringify(missingFieldBody));

    const malformedJsonResponse = await checkReturnPost(
      jsonRequest("http://localhost:3000/api/check-return", "{not-valid-json")
    );
    const malformedJsonBody = await malformedJsonResponse.json();

    expect(malformedJsonResponse.status).toBe(400);
    expect(malformedJsonBody).toEqual({
      success: false,
      error: "Invalid request",
      details: [{ path: "body", message: "Invalid JSON body." }],
    });
    expectNoStackTrace(JSON.stringify(malformedJsonBody));
  });
});
