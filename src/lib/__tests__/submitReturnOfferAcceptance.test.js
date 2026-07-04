import { describe, expect, it } from "vitest";
import {
  buildSubmitReturnOfferAcceptanceInput,
  deriveLegalReviewRequiredFromDecision,
  deriveServerApprovedOfferType,
  deriveSubmitReturnOfferSource,
  deriveTrustedRecoveryAdjustments,
} from "@/lib/submitReturnOfferAcceptance";

const recoveryRules = [
  {
    type: "STORE_CREDIT",
    enabled: true,
    actions: { bonusPercent: 10 },
  },
  {
    type: "PARTIAL_REFUND",
    enabled: true,
    actions: { maxRefundPercent: 20 },
  },
];

describe("submitReturnOfferAcceptance", () => {
  it("derives legal review from server decision only", () => {
    expect(
      deriveLegalReviewRequiredFromDecision({
        recommendedAction: "LEGAL_REVIEW_REQUIRED",
      }),
    ).toBe(true);
    expect(
      deriveLegalReviewRequiredFromDecision({
        recommendedAction: "OFFER_EXCHANGE",
      }),
    ).toBe(false);
  });

  it("overrides customer exchange with LEGAL_REVIEW_REQUIRED", () => {
    const itemDecision = {
      recommendedAction: "LEGAL_REVIEW_REQUIRED",
      dynamicOfferLadder: {
        manualReviewRequired: true,
        blockedReason: "legal_review_required",
      },
    };

    expect(
      deriveServerApprovedOfferType("Exchange Product", itemDecision),
    ).toBe("LEGAL_REVIEW_REQUIRED");
  });

  it("uses RULE_ENGINE when server constrains customer intent", () => {
    expect(
      deriveSubmitReturnOfferSource({
        customerSelectedOptionLabel: "Exchange Product",
        serverApprovedType: "MANUAL_REVIEW",
        itemDecision: {
          productExcluded: true,
          recommendedAction: "MANUAL_REVIEW",
        },
      }),
    ).toBe("RULE_ENGINE");
  });

  it("uses CUSTOMER_SELECTED when customer intent matches server approval", () => {
    expect(
      deriveSubmitReturnOfferSource({
        customerSelectedOptionLabel: "Exchange Product",
        serverApprovedType: "EXCHANGE",
        itemDecision: {
          recommendedAction: "OFFER_EXCHANGE",
        },
      }),
    ).toBe("CUSTOMER_SELECTED");
  });

  it("derives trusted store credit bonus from recovery rules", () => {
    expect(
      deriveTrustedRecoveryAdjustments({
        orderItem: { price: 100, quantity: 1 },
        acceptedOfferType: "STORE_CREDIT",
        recoveryRules,
      }),
    ).toEqual({ storeCreditBonusCents: 1000 });
  });

  it("derives trusted partial refund amount from recovery rules", () => {
    expect(
      deriveTrustedRecoveryAdjustments({
        orderItem: { price: 100, quantity: 1 },
        acceptedOfferType: "PARTIAL_REFUND",
        recoveryRules,
      }),
    ).toEqual({ partialRefundAmountCents: 2000 });
  });

  it("builds exchange acceptance with server-derived recovery amount", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: {
        id: "return-item-1",
        riskLevel: "LOW",
        reason: "WRONG_SIZE",
      },
      orderItem: { price: 100, quantity: 1 },
      itemDecision: { recommendedAction: "OFFER_EXCHANGE" },
      customerSelectedOptionLabel: "Exchange Product",
      returnRequestItem: { returnReason: "wrong_size" },
      order: { currency: "AUD" },
    });

    expect(input.acceptedOfferType).toBe("EXCHANGE");
    expect(input.offerSource).toBe("CUSTOMER_SELECTED");
    expect(input.recoveryAmountCents).toBe(10000);
    expect(input.legalReviewRequired).toBe(false);
  });

  it("builds legal review acceptance with zero recovery", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1", riskLevel: "HIGH" },
      orderItem: { price: 100, quantity: 1 },
      itemDecision: {
        recommendedAction: "LEGAL_REVIEW_REQUIRED",
        dynamicOfferLadder: {
          manualReviewRequired: true,
          blockedReason: "legal_review_required",
        },
      },
      customerSelectedOptionLabel: "Exchange Product",
      returnRequestItem: { returnReason: "damaged_item" },
    });

    expect(input.acceptedOfferType).toBe("LEGAL_REVIEW_REQUIRED");
    expect(input.legalReviewRequired).toBe(true);
    expect(input.recoveryAmountCents).toBe(0);
    expect(input.offerSource).toBe("RULE_ENGINE");
  });

  it("normalizes unknown selected option to MANUAL_REVIEW", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1" },
      orderItem: { price: 100, quantity: 1 },
      itemDecision: { recommendedAction: "OFFER_EXCHANGE" },
      customerSelectedOptionLabel: "Mystery Option",
    });

    expect(input.acceptedOfferType).toBe("MANUAL_REVIEW");
  });

  it("sanitizes unsafe metadata and excludes client financial values", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1", riskLevel: "LOW" },
      orderItem: { price: 100, quantity: 1 },
      itemDecision: {
        recommendedAction: "OFFER_STORE_CREDIT",
        dynamicOfferLadder: { engineVersion: "dynamic_offer_ladder_v1" },
      },
      customerSelectedOptionLabel: "Store Credit",
      recoveryRules,
      returnRequestItem: {
        returnReason: "changed_mind",
        recoveryAmountCents: 999999,
        partialRefundAmountCents: 999999,
        storeCreditBonusCents: 999999,
        offerSource: "AI",
        legalReviewRequired: false,
        proofImage: "data:image/png;base64,abc",
        accessToken: "shpat_secret",
      },
    });

    expect(input.recoveryAmountCents).toBe(9000);
    expect(input.offerSource).toBe("CUSTOMER_SELECTED");
    expect(input.legalReviewRequired).toBe(false);
    expect(input.metadata).toMatchObject({
      reason: "changed_mind",
      riskLevel: "LOW",
      recoveryDecision: "OFFER_STORE_CREDIT",
      ruleVersion: "dynamic_offer_ladder_v1",
    });
    expect(input.metadata).not.toHaveProperty("accessToken");
    expect(input.metadata).not.toHaveProperty("proofImage");
    expect(input.metadata).not.toHaveProperty("recoveryAmountCents");
  });

  it("forces legal review even when client intent says otherwise", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1" },
      orderItem: { price: 100, quantity: 1 },
      itemDecision: { recommendedAction: "LEGAL_REVIEW_REQUIRED" },
      customerSelectedOptionLabel: "Exchange Product",
      returnRequestItem: {
        returnReason: "damaged_item",
        legalReviewRequired: false,
        recoveryAmountCents: 50000,
      },
    });

    expect(input.legalReviewRequired).toBe(true);
    expect(input.acceptedOfferType).toBe("LEGAL_REVIEW_REQUIRED");
    expect(input.recoveryAmountCents).toBe(0);
  });

  it("ignores client-supplied offerSource and financial values", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1" },
      orderItem: { price: 100, quantity: 1 },
      itemDecision: { recommendedAction: "OFFER_EXCHANGE" },
      customerSelectedOptionLabel: "Exchange Product",
      returnRequestItem: {
        offerSource: "AI",
        recoveryAmountCents: 1,
        partialRefundAmountCents: 1,
        storeCreditBonusCents: 1,
      },
    });

    expect(input.offerSource).toBe("CUSTOMER_SELECTED");
    expect(input.recoveryAmountCents).toBe(10000);
  });

  it("uses FOLLOW_UP_ENGINE when server-side follow-up context influenced the final option", () => {
    const itemDecision = {
      recommendedAction: "OFFER_STORE_CREDIT",
      followUpQuestion: {
        shouldAskFollowUp: true,
        question: "Would a different size work for you?",
        questionType: "size_preference",
        source: "fallback",
      },
    };

    expect(
      deriveSubmitReturnOfferSource({
        customerSelectedOptionLabel: "Store Credit",
        serverApprovedType: "STORE_CREDIT",
        itemDecision,
        returnRequestItem: {
          comment: "uncomfortable wear",
        },
      }),
    ).toBe("FOLLOW_UP_ENGINE");

    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1" },
      orderItem: { price: 100, quantity: 1 },
      itemDecision,
      customerSelectedOptionLabel: "Store Credit",
      recoveryRules,
      returnRequestItem: {
        returnReason: "wrong_size",
        comment: "uncomfortable wear",
      },
    });

    expect(input.offerSource).toBe("FOLLOW_UP_ENGINE");
    expect(input.offerSource).not.toMatch(/AI|ANTHROPIC|CLAUDE|LLM/i);
  });

  it("uses zero recovery when trusted item price is unavailable", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1" },
      orderItem: null,
      itemDecision: { recommendedAction: "OFFER_EXCHANGE" },
      customerSelectedOptionLabel: "Exchange Product",
      returnRequestItem: {
        recoveryAmountCents: 999999,
        partialRefundAmountCents: 999999,
        storeCreditBonusCents: 999999,
      },
    });

    expect(input.recoveryAmountCents).toBe(0);
    expect(input.metadata).toEqual(
      expect.objectContaining({
        trustedRecoveryAmountUnavailable: true,
      }),
    );
  });

  it("never maps unexpected AI-like itemDecision source values to offerSource", () => {
    const input = buildSubmitReturnOfferAcceptanceInput({
      merchantId: "merchant-1",
      returnRequestId: "return-1",
      returnItem: { id: "return-item-1" },
      orderItem: { price: 100, quantity: 1 },
      itemDecision: {
        recommendedAction: "OFFER_EXCHANGE",
        source: "ANTHROPIC",
        offerSource: "AI",
      },
      customerSelectedOptionLabel: "Exchange Product",
    });

    expect(input.offerSource).toBe("CUSTOMER_SELECTED");
    expect(input.offerSource).not.toMatch(/AI|ANTHROPIC|CLAUDE|LLM/i);
  });
});
