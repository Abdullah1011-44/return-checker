import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACCEPTED_OFFER_TYPES,
  calculateRecoveryAmountCents,
  normalizeOfferSource,
  normalizeOfferType,
  OFFER_SOURCES,
  OfferAcceptanceValidationError,
  recordOfferAcceptance,
  sanitizeOfferAcceptanceMetadata,
} from "@/lib/offerAcceptanceTracking";
import {
  createMockPrisma,
  resetMockPrisma,
} from "../../../tests/helpers/mockPrisma.js";

const mockPrisma = createMockPrisma();

const baseItem = {
  price: "100.00",
  quantity: 1,
};

describe("offerAcceptanceTracking", () => {
  beforeEach(() => {
    resetMockPrisma();
    vi.clearAllMocks();
  });

  describe("normalizeOfferType", () => {
    it("normalizes known offer types", () => {
      expect(normalizeOfferType("exchange")).toBe("EXCHANGE");
      expect(normalizeOfferType("OFFER_STORE_CREDIT")).toBe("STORE_CREDIT");
      expect(normalizeOfferType("LEGAL_REVIEW")).toBe("LEGAL_REVIEW_REQUIRED");
    });

    it("normalizes unknown offer type to MANUAL_REVIEW", () => {
      expect(normalizeOfferType("MYSTERY_OFFER")).toBe("MANUAL_REVIEW");
      expect(normalizeOfferType(null)).toBe("MANUAL_REVIEW");
    });
  });

  describe("normalizeOfferSource", () => {
    it("normalizes known offer sources", () => {
      expect(normalizeOfferSource("customer_selected")).toBe(
        "CUSTOMER_SELECTED",
      );
      expect(normalizeOfferSource("follow_up")).toBe("FOLLOW_UP_ENGINE");
    });

    it("normalizes unknown offer source to SYSTEM_DEFAULT", () => {
      expect(normalizeOfferSource("UNKNOWN")).toBe("SYSTEM_DEFAULT");
      expect(normalizeOfferSource(null)).toBe("SYSTEM_DEFAULT");
    });

    it("does not allow AI as offerSource", () => {
      for (const source of ["AI", "AI_ENGINE", "ANTHROPIC", "CLAUDE", "LLM"]) {
        expect(normalizeOfferSource(source)).toBe("SYSTEM_DEFAULT");
      }
    });
  });

  describe("calculateRecoveryAmountCents", () => {
    it("records accepted exchange offer at full item price", () => {
      expect(
        calculateRecoveryAmountCents({
          item: baseItem,
          acceptedOfferType: "EXCHANGE",
        }),
      ).toEqual({ recoveryAmountCents: 10000 });
    });

    it("records store credit and subtracts bonus", () => {
      expect(
        calculateRecoveryAmountCents({
          item: baseItem,
          acceptedOfferType: "STORE_CREDIT",
          storeCreditBonusCents: 1000,
        }),
      ).toEqual({
        recoveryAmountCents: 9000,
        metadata: {
          recoveryCalculation: "store_credit_bonus_subtracted",
          storeCreditBonusCents: 1000,
        },
      });
    });

    it("records partial refund and subtracts refund amount", () => {
      expect(
        calculateRecoveryAmountCents({
          item: baseItem,
          acceptedOfferType: "PARTIAL_REFUND",
          partialRefundAmountCents: 3000,
        }),
      ).toEqual({
        recoveryAmountCents: 7000,
        metadata: {
          recoveryCalculation: "partial_refund_subtracted",
          partialRefundAmountCents: 3000,
        },
      });
    });

    it("records manual review with zero recovery", () => {
      expect(
        calculateRecoveryAmountCents({
          item: baseItem,
          acceptedOfferType: "MANUAL_REVIEW",
        }),
      ).toEqual({ recoveryAmountCents: 0 });
    });

    it("records legal review required as distinct from manual review", () => {
      const manual = calculateRecoveryAmountCents({
        item: baseItem,
        acceptedOfferType: "MANUAL_REVIEW",
      });
      const legal = calculateRecoveryAmountCents({
        item: baseItem,
        acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
      });

      expect(manual.recoveryAmountCents).toBe(0);
      expect(legal.recoveryAmountCents).toBe(0);
      expect(normalizeOfferType("MANUAL_REVIEW")).toBe("MANUAL_REVIEW");
      expect(normalizeOfferType("LEGAL_REVIEW_REQUIRED")).toBe(
        "LEGAL_REVIEW_REQUIRED",
      );
    });

    it("calculates recovery amount safely when item price is missing", () => {
      expect(
        calculateRecoveryAmountCents({
          item: {},
          acceptedOfferType: "EXCHANGE",
        }),
      ).toEqual({
        recoveryAmountCents: 0,
        metadata: {
          missingItemPriceReason: "missing_item_price",
          recoveryCalculation: "zero_item_price",
        },
      });
    });
  });

  describe("sanitizeOfferAcceptanceMetadata", () => {
    it("sanitizes unsafe metadata fields", () => {
      expect(
        sanitizeOfferAcceptanceMetadata({
          reason: "wrong_size",
          riskLevel: "MEDIUM",
          decisionCode: "RULE_MATCHED",
          ladderPosition: 1,
          followUpSummary: "Asked about size preference",
          ruleVersion: "v1",
          accessToken: "shpat_secret",
          shopifyAccessToken: "shpat_secret",
          authorization: "Bearer secret",
          cookie: "session=abc",
          proofImage: "data:image/png;base64,abc",
          email: "customer@example.com",
        }),
      ).toEqual({
        reason: "wrong_size",
        riskLevel: "MEDIUM",
        decisionCode: "RULE_MATCHED",
        ladderPosition: 1,
        followUpSummary: "Asked about size preference",
        ruleVersion: "v1",
      });
    });
  });

  describe("recordOfferAcceptance", () => {
    const baseRecord = {
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItemId: "return-item-1",
      acceptedOfferType: "EXCHANGE",
      offerSource: "CUSTOMER_SELECTED",
      item: baseItem,
    };

    it("records accepted exchange offer", async () => {
      mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({
        id: "acceptance-1",
        ...baseRecord,
        recoveryAmountCents: 10000,
      });

      const result = await recordOfferAcceptance({
        ...baseRecord,
        prismaClient: mockPrisma,
      });

      expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith({
        where: { returnItemId: "return-item-1" },
        create: expect.objectContaining({
          merchantId: "merchant-1",
          returnRequestId: "return-1",
          returnItemId: "return-item-1",
          acceptedOfferType: "EXCHANGE",
          offerSource: "CUSTOMER_SELECTED",
          recoveryAmountCents: 10000,
          legalReviewRequired: false,
        }),
        update: expect.objectContaining({
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 10000,
        }),
      });
      expect(result.recoveryAmountCents).toBe(10000);
    });

    it("legalReviewRequired forces zero recovery and LEGAL_REVIEW_REQUIRED type", async () => {
      mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({
        id: "acceptance-legal",
      });

      await recordOfferAcceptance({
        ...baseRecord,
        acceptedOfferType: "EXCHANGE",
        legalReviewRequired: true,
        recoveryAmountCents: 5000,
        prismaClient: mockPrisma,
      });

      expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
            recoveryAmountCents: 0,
            legalReviewRequired: true,
          }),
          update: expect.objectContaining({
            acceptedOfferType: "LEGAL_REVIEW_REQUIRED",
            recoveryAmountCents: 0,
            legalReviewRequired: true,
          }),
        }),
      );
    });

    it("updates existing acceptance instead of duplicating", async () => {
      mockPrisma.returnOfferAcceptance.upsert
        .mockResolvedValueOnce({
          id: "acceptance-1",
          acceptedOfferType: "EXCHANGE",
          recoveryAmountCents: 10000,
        })
        .mockResolvedValueOnce({
          id: "acceptance-1",
          acceptedOfferType: "STORE_CREDIT",
          recoveryAmountCents: 9000,
        });

      await recordOfferAcceptance({ ...baseRecord, prismaClient: mockPrisma });
      await recordOfferAcceptance({
        ...baseRecord,
        acceptedOfferType: "STORE_CREDIT",
        offerSource: "RULE_ENGINE",
        storeCreditBonusCents: 1000,
        prismaClient: mockPrisma,
      });

      expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { returnItemId: "return-item-1" },
          update: expect.objectContaining({
            acceptedOfferType: "STORE_CREDIT",
            recoveryAmountCents: 9000,
            offerSource: "RULE_ENGINE",
          }),
        }),
      );
    });

    it("rejects missing merchantId", async () => {
      await expect(
        recordOfferAcceptance({
          ...baseRecord,
          merchantId: "",
          prismaClient: mockPrisma,
        }),
      ).rejects.toThrow(OfferAcceptanceValidationError);
    });

    it("rejects missing returnRequestId", async () => {
      await expect(
        recordOfferAcceptance({
          ...baseRecord,
          returnRequestId: "",
          prismaClient: mockPrisma,
        }),
      ).rejects.toThrow(OfferAcceptanceValidationError);
    });

    it("rejects missing returnItemId", async () => {
      await expect(
        recordOfferAcceptance({
          ...baseRecord,
          returnItemId: "",
          prismaClient: mockPrisma,
        }),
      ).rejects.toThrow(OfferAcceptanceValidationError);
    });

    it("normalizes unknown offer type to MANUAL_REVIEW when recording", async () => {
      mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "x" });

      await recordOfferAcceptance({
        ...baseRecord,
        acceptedOfferType: "UNKNOWN_TYPE",
        prismaClient: mockPrisma,
      });

      expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            acceptedOfferType: "MANUAL_REVIEW",
            recoveryAmountCents: 0,
          }),
        }),
      );
    });

    it("normalizes unknown offer source to SYSTEM_DEFAULT when recording", async () => {
      mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "x" });

      await recordOfferAcceptance({
        ...baseRecord,
        offerSource: "UNKNOWN_SOURCE",
        prismaClient: mockPrisma,
      });

      expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            offerSource: "SYSTEM_DEFAULT",
          }),
        }),
      );
    });

    it("does not allow AI as offerSource when recording", async () => {
      mockPrisma.returnOfferAcceptance.upsert.mockResolvedValue({ id: "x" });

      await recordOfferAcceptance({
        ...baseRecord,
        offerSource: "ANTHROPIC",
        prismaClient: mockPrisma,
      });

      expect(mockPrisma.returnOfferAcceptance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            offerSource: "SYSTEM_DEFAULT",
          }),
        }),
      );
    });
  });

  describe("schema constraints", () => {
    it("supports required accepted offer types", () => {
      expect(ACCEPTED_OFFER_TYPES).toEqual([
        "EXCHANGE",
        "STORE_CREDIT",
        "PARTIAL_REFUND",
        "MANUAL_REVIEW",
        "LEGAL_REVIEW_REQUIRED",
      ]);
    });

    it("supports required offer sources without AI", () => {
      expect(OFFER_SOURCES).toEqual([
        "CUSTOMER_SELECTED",
        "RULE_ENGINE",
        "FOLLOW_UP_ENGINE",
        "MERCHANT_MANUAL",
        "SYSTEM_DEFAULT",
      ]);
      expect(OFFER_SOURCES).not.toContain("AI");
    });

    it("DB unique constraint prevents duplicate current acceptance per returnItemId", () => {
      const schema = readFileSync(
        path.join(process.cwd(), "prisma/schema.prisma"),
        "utf8",
      );

      expect(schema).toMatch(
        /model ReturnOfferAcceptance[\s\S]*?returnItemId\s+String\s+@unique/,
      );
    });
  });
});
