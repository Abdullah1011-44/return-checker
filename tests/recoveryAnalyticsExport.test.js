import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSydneyAnalyticsRangeBounds,
  isInstantWithinRange,
} from "@/lib/recoveryAnalytics";
import {
  buildRecoveryExportCsv,
  buildRecoveryExportRows,
  escapeCsvCell,
  formatRecoveryExportAudAmount,
  mapAcceptanceToExportRow,
  RECOVERY_EXPORT_CSV_HEADERS,
  sanitizeCsvFormulaInjection,
} from "@/lib/recoveryAnalyticsExport";
import {
  createMockMerchant,
  createMockMerchantB,
} from "./helpers/mockMerchant.js";

const mockRequireMerchant = vi.fn();
const mockLoadMerchantRecoveryExportCsv = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireMerchant: (...args) => mockRequireMerchant(...args),
}));

vi.mock("@/lib/recoveryAnalyticsExport", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadMerchantRecoveryExportCsv: (...args) =>
      mockLoadMerchantRecoveryExportCsv(...args),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));

vi.mock("@/lib/sentry", () => ({
  captureException: (...args) => mockCaptureException(...args),
}));

import { GET } from "@/app/api/dashboard/recovery/export/route";

const merchant = createMockMerchant();
const otherMerchant = createMockMerchantB();
const NOW = new Date("2026-06-15T04:00:00.000Z");
const BOUNDS = getSydneyAnalyticsRangeBounds("30d", NOW);

function buildExportRequest(query = "") {
  const suffix = query ? `?${query}` : "";
  return new Request(
    `http://localhost/api/dashboard/recovery/export${suffix}`,
    {
      method: "GET",
    },
  );
}

function createAcceptance(overrides = {}) {
  return {
    id: "acceptance-1",
    merchantId: merchant.id,
    returnRequestId: "return-1",
    returnItemId: "return-item-1",
    acceptedOfferType: "EXCHANGE",
    recoveryAmountCents: 2999,
    legalReviewRequired: false,
    acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
    metadata: { reason: "wrong_size" },
    returnRequest: {
      order: {
        orderNumber: "1001",
      },
    },
    returnItem: {
      reason: "WRONG_SIZE",
      orderItem: {
        productName: "Classic Tee",
        sku: "TEE-001",
        price: 999.99,
      },
    },
    ...overrides,
  };
}

describe("recoveryAnalyticsExport helpers", () => {
  it("builds CSV headers in the required order", () => {
    expect(RECOVERY_EXPORT_CSV_HEADERS).toEqual([
      "Accepted Date",
      "Order",
      "Product",
      "Offer Type",
      "Reason",
      "Estimated Refund Avoided",
    ]);

    const csv = buildRecoveryExportCsv([]);
    expect(csv.startsWith(RECOVERY_EXPORT_CSV_HEADERS.join(","))).toBe(true);
  });

  it("escapes commas, quotes, and newlines", () => {
    expect(escapeCsvCell('Product, "Special"')).toBe('"Product, ""Special"""');
    expect(escapeCsvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it("mitigates formula injection for values starting with =, +, -, or @", () => {
    expect(sanitizeCsvFormulaInjection("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeCsvFormulaInjection("+1234")).toBe("'+1234");
    expect(sanitizeCsvFormulaInjection("-100")).toBe("'-100");
    expect(sanitizeCsvFormulaInjection("@cmd")).toBe("'@cmd");
    expect(escapeCsvCell('=HYPERLINK("evil")')).toBe(
      '"\'=HYPERLINK(""evil"")"',
    );
  });

  it("filters rows by acceptedAt and accepted recovery offer types only", () => {
    const rows = buildRecoveryExportRows(
      [
        createAcceptance({
          returnItemId: "item-1",
          acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
        }),
        createAcceptance({
          id: "a2",
          returnItemId: "item-2",
          acceptedOfferType: "MANUAL_REVIEW",
          recoveryAmountCents: 9000,
          acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
        }),
        createAcceptance({
          id: "a3",
          returnItemId: "item-3",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 1500,
          acceptedAt: new Date("2026-05-01T05:00:00.000Z"),
        }),
        createAcceptance({
          id: "a4",
          returnItemId: "item-4",
          acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
          recoveryAmountCents: 7000,
          acceptedAt: new Date("2026-06-10T05:00:00.000Z"),
        }),
      ],
      BOUNDS,
      { merchantId: merchant.id },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].offerType).toBe("Exchange");
    expect(
      isInstantWithinRange(
        new Date("2026-06-10T05:00:00.000Z"),
        BOUNDS.startInclusive,
        BOUNDS.endExclusive,
      ),
    ).toBe(true);
  });

  it("exports recoveryAmountCents snapshot and does not recalculate from product price", () => {
    const row = mapAcceptanceToExportRow(
      createAcceptance({
        recoveryAmountCents: 1234,
        returnItem: {
          reason: "WRONG_SIZE",
          orderItem: {
            productName: "Classic Tee",
            sku: "TEE-001",
            price: 999.99,
          },
        },
      }),
    );

    expect(row.estimatedRefundAvoided).toBe(
      formatRecoveryExportAudAmount(1234),
    );
    expect(row.estimatedRefundAvoided).not.toBe(
      formatRecoveryExportAudAmount(99999),
    );
  });

  it("returns valid CSV headers for zero data", () => {
    const csv = buildRecoveryExportCsv([]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(RECOVERY_EXPORT_CSV_HEADERS.join(","));
  });
});

describe("GET /api/dashboard/recovery/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMerchant.mockResolvedValue(merchant);
    mockLoadMerchantRecoveryExportCsv.mockResolvedValue({
      csv: `${RECOVERY_EXPORT_CSV_HEADERS.join(",")}\r\n`,
      rows: [],
      range: "30d",
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const unauthorized = new Error("Unauthorized");
    unauthorized.status = 401;
    mockRequireMerchant.mockRejectedValue(unauthorized);

    const response = await GET(buildExportRequest("range=30d"));

    expect(response.status).toBe(401);
    expect(mockLoadMerchantRecoveryExportCsv).not.toHaveBeenCalled();
  });

  it("uses the authenticated merchant from requireMerchant", async () => {
    const response = await GET(buildExportRequest("range=30d"));

    expect(response.status).toBe(200);
    expect(mockRequireMerchant).toHaveBeenCalledTimes(1);
    expect(mockLoadMerchantRecoveryExportCsv).toHaveBeenCalledWith(
      expect.anything(),
      merchant.id,
      expect.objectContaining({ range: "30d" }),
    );
  });

  it("does not allow client merchantId to override the session merchant", async () => {
    const response = await GET(
      buildExportRequest(`range=30d&merchantId=${otherMerchant.id}`),
    );

    expect(response.status).toBe(400);
    expect(mockRequireMerchant).not.toHaveBeenCalled();
    expect(mockLoadMerchantRecoveryExportCsv).not.toHaveBeenCalled();
  });

  it.each(["7d", "30d", "90d"])(
    "passes supported range %s to export loader",
    async (range) => {
      mockLoadMerchantRecoveryExportCsv.mockResolvedValue({
        csv: `${RECOVERY_EXPORT_CSV_HEADERS.join(",")}\r\n`,
        rows: [],
        range,
      });

      const response = await GET(buildExportRequest(`range=${range}`));

      expect(response.status).toBe(200);
      expect(mockLoadMerchantRecoveryExportCsv).toHaveBeenCalledWith(
        expect.anything(),
        merchant.id,
        expect.objectContaining({ range }),
      );
    },
  );

  it("returns 400 for invalid range", async () => {
    const response = await GET(buildExportRequest("range=14d"));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(mockRequireMerchant).not.toHaveBeenCalled();
    expect(mockLoadMerchantRecoveryExportCsv).not.toHaveBeenCalled();
  });

  it("returns CSV response headers and body", async () => {
    const csv = [
      RECOVERY_EXPORT_CSV_HEADERS.join(","),
      "10/06/2026, 15:00,1001,Classic Tee (TEE-001),Exchange,Wrong size,$29.99",
    ].join("\r\n");
    mockLoadMerchantRecoveryExportCsv.mockResolvedValue({
      csv: `${csv}\r\n`,
      rows: [
        {
          acceptedDate: "10/06/2026, 15:00",
          order: "1001",
          product: "Classic Tee (TEE-001)",
          offerType: "Exchange",
          reason: "Wrong size",
          estimatedRefundAvoided: "$29.99",
        },
      ],
      range: "30d",
    });

    const response = await GET(buildExportRequest("range=30d"));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="recovery-analytics.csv"',
    );
    expect(body).toContain(
      "Accepted Date,Order,Product,Offer Type,Reason,Estimated Refund Avoided",
    );
    expect(body).toContain("Classic Tee (TEE-001)");
  });

  it("returns valid CSV headers when export data is empty", async () => {
    const response = await GET(buildExportRequest());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe(`${RECOVERY_EXPORT_CSV_HEADERS.join(",")}\r\n`);
  });
});
