import { describe, expect, it } from "vitest";
import {
  isDashboardApiSuccess,
  normalizeDashboardRequest,
  normalizeDashboardRequestsResponse,
  processDashboardRequestsLoadResult,
  shouldShowDashboardLoadingSpinner,
} from "@/lib/dashboardFetch";

function mockResponse(status, ok = status >= 200 && status < 300) {
  return {
    ok,
    status,
  };
}

describe("dashboardFetch", () => {
  describe("normalizeDashboardRequestsResponse", () => {
    it("reads requests from { success: true, requests: [...] }", () => {
      const requests = normalizeDashboardRequestsResponse({
        success: true,
        requests: [
          {
            id: "req-1",
            email: "customer@example.com",
            orderNumber: "1001",
          },
        ],
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].id).toBe("req-1");
      expect(requests[0].email).toBe("customer@example.com");
    });

    it("falls back to returnRequests and nested data shapes", () => {
      expect(
        normalizeDashboardRequestsResponse({
          success: true,
          returnRequests: [{ id: "req-2", customerEmail: "a@example.com" }],
        }),
      ).toHaveLength(1);

      expect(
        normalizeDashboardRequestsResponse({
          success: true,
          data: { requests: [{ id: "req-3", email: "b@example.com" }] },
        }),
      ).toHaveLength(1);
    });

    it("returns empty array for missing or invalid payloads", () => {
      expect(normalizeDashboardRequestsResponse(null)).toEqual([]);
      expect(normalizeDashboardRequestsResponse({ success: true })).toEqual([]);
    });
  });

  describe("normalizeDashboardRequest", () => {
    it("fills missing optional fields with safe defaults", () => {
      const request = normalizeDashboardRequest({ id: "req-4" });

      expect(request).toMatchObject({
        id: "req-4",
        email: "",
        orderNumber: "",
        status: "Pending Review",
        riskLevel: "Medium",
        recoveryScore: 0,
        bestAction: "Manual Review",
        selectedItems: [],
        returnRequestItems: [],
        orderItems: [],
      });
    });

    it("uses customerEmail when email is missing", () => {
      const request = normalizeDashboardRequest({
        id: "req-5",
        customerEmail: "merchant-customer@example.com",
      });

      expect(request?.email).toBe("merchant-customer@example.com");
    });
  });

  describe("processDashboardRequestsLoadResult", () => {
    it("returns requests on successful fetch shape", () => {
      const result = processDashboardRequestsLoadResult({
        res: mockResponse(200),
        data: {
          success: true,
          requests: [{ id: "req-6", email: "ok@example.com" }],
        },
      });

      expect(result.ok).toBe(true);
      expect(result.requests).toHaveLength(1);
      expect(result.error).toBeNull();
      expect(result.shouldClearRequests).toBe(false);
    });

    it("returns error and clear flag on failed fetch for initial load", () => {
      const result = processDashboardRequestsLoadResult({
        res: mockResponse(500, false),
        data: { success: false, message: "Server error" },
      });

      expect(result.ok).toBe(false);
      expect(result.requests).toBeNull();
      expect(result.error).toBe("Server error");
      expect(result.shouldClearRequests).toBe(true);
    });

    it("preserves existing requests on background refresh failure", () => {
      const result = processDashboardRequestsLoadResult({
        res: mockResponse(500, false),
        data: { success: false },
        background: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeNull();
      expect(result.shouldClearRequests).toBe(false);
    });

    it("does not clear requests when sync-style background fetch aborts", () => {
      const result = processDashboardRequestsLoadResult({
        res: null,
        data: {},
        aborted: true,
        background: true,
      });

      expect(result.ok).toBe(false);
      expect(result.shouldClearRequests).toBe(false);
    });
  });

  describe("isDashboardApiSuccess", () => {
    it("requires ok response and success true", () => {
      expect(isDashboardApiSuccess(mockResponse(200), { success: true })).toBe(
        true,
      );
      expect(
        isDashboardApiSuccess(mockResponse(401, false), { success: true }),
      ).toBe(false);
      expect(isDashboardApiSuccess(mockResponse(200), { success: false })).toBe(
        false,
      );
    });
  });
});

describe("dashboard loading spinner visibility", () => {
  it("hides spinner when requests are available even if loading is true", () => {
    expect(shouldShowDashboardLoadingSpinner(true, 0)).toBe(true);
    expect(shouldShowDashboardLoadingSpinner(true, 3)).toBe(false);
    expect(shouldShowDashboardLoadingSpinner(false, 0)).toBe(false);
  });
});
