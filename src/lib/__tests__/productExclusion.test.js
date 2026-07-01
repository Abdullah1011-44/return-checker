import { describe, expect, it } from "vitest";
import {
  buildProductExclusionItemContext,
  evaluateProductExclusion,
  PRODUCT_EXCLUSION_RULE_TYPE,
  parseProductExclusionConditions,
} from "@/lib/productExclusion";
import {
  evaluateReturnPolicy,
  POLICY_DECISIONS,
  POLICY_REASONS,
} from "@/lib/returnPolicyEngine";

/**
 * Test fixtures for merchant-defined PRODUCT_EXCLUSION conditions.
 * These are examples only — merchants configure matchers via RecoveryRules;
 * nothing here is hardcoded into production evaluation globally.
 *
 * Example conditions array shapes:
 * - gift card:     { id: "gift-card", matcherType: "giftCard" }
 * - final sale:    { id: "final-sale", matcherType: "sku", value: "FINAL-SALE-001" }
 * - clearance:     { id: "clearance", matcherType: "tag", value: "clearance" }
 * - digital:       { id: "digital", matcherType: "productType", value: "Digital" }
 * - personalized:  { id: "custom", matcherType: "tag", value: "personalized" }
 * - hygiene:       { id: "hygiene", matcherType: "productType", value: "Hygiene" }
 */
function exclusionRule(conditions, enabled = true) {
  return {
    type: PRODUCT_EXCLUSION_RULE_TYPE,
    enabled,
    priority: 0,
    conditions,
    actions: {},
  };
}

describe("productExclusion", () => {
  it("returns no match when PRODUCT_EXCLUSION rule is missing", () => {
    const result = evaluateProductExclusion(null, { sku: "FINAL-SALE-001" });
    expect(result).toEqual({ productExcluded: false });
  });

  it("returns no match when PRODUCT_EXCLUSION conditions are missing", () => {
    const result = evaluateProductExclusion(exclusionRule(undefined), {
      sku: "FINAL-SALE-001",
    });
    expect(result).toEqual({ productExcluded: false });
  });

  it("treats malformed PRODUCT_EXCLUSION conditions as a no-op", () => {
    const result = evaluateProductExclusion(
      exclusionRule({ matcherType: "sku", value: "oops" }),
      { sku: "FINAL-SALE-001" },
    );
    expect(result).toEqual({ productExcluded: false });
  });

  it("parses PRODUCT_EXCLUSION conditions as an array of matchers", () => {
    const parsed = parseProductExclusionConditions([
      {
        id: "gift-card-exclusion",
        matcherType: "tag",
        value: "gift-card",
        reason: "Gift cards are excluded",
      },
    ]);

    expect(parsed.ok).toBe(true);
    expect(parsed.matchers).toHaveLength(1);
  });

  it("excludes by SKU", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "final-sale-sku",
          matcherType: "sku",
          value: "FINAL-SALE-001",
          reason: "Final sale SKU",
        },
      ]),
      { sku: "final-sale-001" },
    );

    expect(result.productExcluded).toBe(true);
    expect(result.exclusionRuleId).toBe("final-sale-sku");
    expect(result.matchedField).toBe("sku");
  });

  it("excludes by Shopify product ID", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "product-id",
          matcherType: "productId",
          value: "gid://shopify/Product/123",
        },
      ]),
      buildProductExclusionItemContext({
        shopifyProductId: "gid://shopify/Product/123",
      }),
    );

    expect(result.productExcluded).toBe(true);
    expect(result.matchedField).toBe("productId");
  });

  it("excludes by Shopify variant ID", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "variant-id",
          matcherType: "variantId",
          value: "gid://shopify/ProductVariant/456",
        },
      ]),
      { shopifyVariantId: "gid://shopify/ProductVariant/456" },
    );

    expect(result.productExcluded).toBe(true);
    expect(result.matchedField).toBe("variantId");
  });

  it("excludes by product tag", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "gift-card-exclusion",
          matcherType: "tag",
          value: "gift-card",
        },
      ]),
      { tags: "seasonal, gift-card, promo" },
    );

    expect(result.productExcluded).toBe(true);
    expect(result.matchedField).toBe("tag");
    expect(result.matchedValue).toBe("gift-card");
  });

  it("excludes by vendor", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "vendor-match",
          matcherType: "vendor",
          value: "Acme Co",
        },
      ]),
      { vendor: "acme co" },
    );

    expect(result.productExcluded).toBe(true);
    expect(result.matchedField).toBe("vendor");
  });

  it("excludes by product type", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "type-match",
          matcherType: "productType",
          value: "Gift Card",
        },
      ]),
      { productType: "gift card" },
    );

    expect(result.productExcluded).toBe(true);
    expect(result.matchedField).toBe("productType");
  });

  it("excludes by titleContains case-insensitively", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "title-match",
          matcherType: "titleContains",
          value: "FINAL SALE",
        },
      ]),
      { title: "Classic Tee - final sale edition" },
    );

    expect(result.productExcluded).toBe(true);
    expect(result.matchedField).toBe("titleContains");
  });

  it("excludes gift card products via giftCard matcher", () => {
    const result = evaluateProductExclusion(
      exclusionRule([
        {
          id: "gift-card",
          matcherType: "giftCard",
        },
      ]),
      { isGiftCard: true, title: "Holiday Gift Card" },
    );

    expect(result.productExcluded).toBe(true);
    expect(result.matchedField).toBe("giftCard");
  });
});

describe("returnPolicyEngine product exclusion decisions", () => {
  function evaluateExcluded(overrides = {}) {
    const matchers = overrides.matchers ?? [
      {
        id: "final-sale-sku",
        matcherType: "sku",
        value: "FINAL-SALE-001",
      },
    ];

    return evaluateReturnPolicy({
      merchantSettings: {
        allowExchanges: true,
        allowStoreCredit: true,
        allowPartialRefunds: true,
      },
      recoveryRules: [
        exclusionRule(matchers),
        {
          id: "exchange-rule",
          type: "EXCHANGE",
          enabled: true,
          priority: 1,
          conditions: {},
        },
      ],
      returnRequest: overrides.returnRequest ?? { reason: "CHANGED_MIND" },
      order: { deliveredAt: new Date().toISOString() },
      items: overrides.items ?? [
        {
          sku: "FINAL-SALE-001",
          reason: overrides.returnRequest?.reason ?? "CHANGED_MIND",
        },
      ],
    });
  }

  it("routes excluded change-of-mind items to MANUAL_REVIEW", () => {
    const result = evaluateExcluded({
      returnRequest: { reason: "CHANGED_MIND" },
      items: [{ sku: "FINAL-SALE-001", reason: "CHANGED_MIND" }],
    });

    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(result.reason).toBe(POLICY_REASONS.PRODUCT_EXCLUDED);
    expect(result.generateOfferLadderInvoked).toBe(false);
    expect(result.recoveryOffers).toEqual([]);
    expect(result.blockedOptions).toContain(POLICY_DECISIONS.EXCHANGE);
  });

  it("routes excluded damaged items to LEGAL_REVIEW_REQUIRED", () => {
    const result = evaluateExcluded({
      returnRequest: { reason: "DAMAGED_ITEM" },
      items: [{ sku: "FINAL-SALE-001", reason: "DAMAGED_ITEM" }],
    });

    expect(result.decision).toBe(POLICY_DECISIONS.MANUAL_REVIEW);
    expect(result.reason).toBe(POLICY_REASONS.LEGAL_REVIEW_REQUIRED);
    expect(result.legalFlags).toContain(
      POLICY_REASONS.ACL_REFUND_RIGHTS_MAY_APPLY,
    );
    expect(result.generateOfferLadderInvoked).toBe(false);
  });

  it("keeps existing behavior when no PRODUCT_EXCLUSION rule exists", () => {
    const result = evaluateReturnPolicy({
      merchantSettings: { allowExchanges: true },
      recoveryRules: [
        {
          id: "exchange-rule",
          type: "EXCHANGE",
          enabled: true,
          priority: 1,
          conditions: {},
        },
      ],
      returnRequest: { reason: "CHANGED_MIND" },
      order: { deliveredAt: new Date().toISOString() },
      items: [{ sku: "TEE-001", reason: "CHANGED_MIND" }],
    });

    expect(result.decision).toBe(POLICY_DECISIONS.EXCHANGE);
    expect(result.generateOfferLadderInvoked).toBe(true);
  });
});
