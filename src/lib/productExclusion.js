/**
 * Product exclusion evaluation (Task 32).
 *
 * Recovery pipeline order (per item):
 *   1. Product Exclusion Check          — pre-flight suppressor (this module)
 *   2. Merchant Settings Gate           — allowExchange / allowStoreCredit / etc.
 *   3. Recovery Rules                   — offer-ladder rule matching
 *   4. AI Guardrails / aiConfidenceThreshold
 *   5. generateOfferLadder()            — skipped when product is excluded
 *   6. Final Decision
 *
 * Product exclusions are NOT normal recovery offers. They run before
 * generateOfferLadder() and suppress automated recovery for matched products.
 *
 * When a product is excluded:
 * - it does not enter the offer ladder pipeline
 * - generateOfferLadder() is not invoked for that item
 * - aiConfidenceThreshold is bypassed (no AI offer is generated)
 * - AI persuasion / recovery offers are suppressed (recoveryOffers: [])
 * - normal non-legal return reasons → recommendedAction MANUAL_REVIEW
 * - faulty / damaged / defective / not-as-described → LEGAL_REVIEW_REQUIRED
 *
 * Product exclusions do not override ACL / consumer-law-safe handling.
 * Excluded products with legal-issue return reasons are never automatically
 * rejected; they route to LEGAL_REVIEW_REQUIRED with ACL review flags.
 *
 * PRODUCT_EXCLUSION storage (MerchantRecoveryRule):
 * - one row per merchant where type === PRODUCT_EXCLUSION
 *   (@@unique([merchantId, type]) — all matchers share one row)
 * - conditions MUST be a JSON array of matcher objects (not a single object)
 * - evaluateProductExclusion() iterates matchers in array order; first match wins
 * - missing, empty, or malformed conditions → no-op (existing behavior preserved)
 *
 * Merchant-maintained matcher examples (configure via conditions only — never
 * hardcoded globally unless product data clearly identifies the product):
 * - gift cards:        { matcherType: "giftCard" } or tag "gift-card"
 * - final sale:        { matcherType: "sku", value: "FINAL-SALE-001" }
 * - hygiene-sensitive: { matcherType: "productType", value: "Hygiene" }
 * - custom/personalized: { matcherType: "tag", value: "personalized" }
 * - clearance:         { matcherType: "tag", value: "clearance" }
 * - digital products:  { matcherType: "productType", value: "Digital" }
 *
 * titleContains matcher:
 * - merchant-maintained product title substring matcher only
 * - comparison is case-insensitive (normalizeComparable + includes)
 * - must NOT be used for return reason classification (reasons use
 *   returnPolicyEngine legal/buyer-remorse detection instead)
 */
import { z } from "zod";
import { safeString } from "@/lib/validation";

export const PRODUCT_EXCLUSION_RULE_TYPE = "PRODUCT_EXCLUSION";

export const PRODUCT_EXCLUSION_MATCHER_TYPES = [
  "productId",
  "variantId",
  "sku",
  "tag",
  "vendor",
  "productType",
  "titleContains",
  "giftCard",
];

const productExclusionMatcherSchema = z
  .object({
    id: safeString(80).min(1, { message: "matcher id is required." }),
    matcherType: z.enum(PRODUCT_EXCLUSION_MATCHER_TYPES, {
      message: "matcherType is invalid.",
    }),
    value: safeString(240).optional(),
    reason: safeString(240).optional(),
  })
  .strict()
  .superRefine((matcher, ctx) => {
    if (matcher.matcherType === "giftCard") {
      return;
    }

    if (!matcher.value?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "matcher value is required.",
        path: ["value"],
      });
    }
  });

export const productExclusionConditionsSchema = z
  .array(productExclusionMatcherSchema)
  .min(1, { message: "At least one exclusion matcher is required." });

const DEFAULT_EXCLUSION_REASON =
  "Product is excluded from automated return recovery";

function normalizeComparable(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim().toLowerCase();
}

function parseTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => normalizeComparable(tag)).filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => normalizeComparable(tag))
      .filter(Boolean);
  }

  return [];
}

/**
 * @param {unknown} conditions
 */
export function parseProductExclusionConditions(conditions) {
  if (conditions == null) {
    return { ok: false, matchers: [], error: "missing" };
  }

  if (!Array.isArray(conditions)) {
    return { ok: false, matchers: [], error: "not_array" };
  }

  if (conditions.length === 0) {
    return { ok: false, matchers: [], error: "empty" };
  }

  const parsed = productExclusionConditionsSchema.safeParse(conditions);
  if (!parsed.success) {
    return { ok: false, matchers: [], error: "invalid" };
  }

  return { ok: true, matchers: parsed.data, error: null };
}

/**
 * @param {Record<string, unknown> | null | undefined} item
 */
export function buildProductExclusionItemContext(item) {
  const orderItem = item?.orderItem ?? item ?? {};
  const product = item?.product ?? orderItem?.product ?? {};

  return {
    shopifyProductId:
      item?.shopifyProductId ??
      orderItem?.shopifyProductId ??
      product?.shopifyProductLegacyId ??
      product?.shopifyProductGid ??
      null,
    shopifyVariantId:
      item?.shopifyVariantId ??
      orderItem?.shopifyVariantId ??
      product?.shopifyVariantLegacyId ??
      product?.shopifyVariantGid ??
      null,
    sku: item?.sku ?? orderItem?.sku ?? product?.sku ?? null,
    productType: item?.productType ?? product?.productType ?? null,
    vendor: item?.vendor ?? product?.vendor ?? null,
    tags: item?.tags ?? product?.tags ?? null,
    title:
      item?.title ??
      item?.productName ??
      orderItem?.productName ??
      product?.title ??
      null,
    isGiftCard:
      item?.isGiftCard === true ||
      product?.isGiftCard === true ||
      orderItem?.isGiftCard === true,
  };
}

function matchesGiftCard(context) {
  if (context.isGiftCard === true) {
    return { matched: true, matchedValue: "isGiftCard" };
  }

  const tags = parseTags(context.tags);
  if (tags.some((tag) => tag === "gift-card" || tag === "gift_card")) {
    return { matched: true, matchedValue: "gift-card" };
  }

  const title = normalizeComparable(context.title);
  if (title.includes("gift card") || title.includes("gift-card")) {
    return { matched: true, matchedValue: title };
  }

  return { matched: false, matchedValue: null };
}

/**
 * @param {z.infer<typeof productExclusionMatcherSchema>} matcher
 * @param {ReturnType<typeof buildProductExclusionItemContext>} context
 */
function matcherMatches(matcher, context) {
  const expected = normalizeComparable(matcher.value);

  switch (matcher.matcherType) {
    case "productId": {
      const actual = normalizeComparable(context.shopifyProductId);
      return actual.length > 0 && actual === expected
        ? { matched: true, matchedValue: context.shopifyProductId }
        : { matched: false, matchedValue: null };
    }
    case "variantId": {
      const actual = normalizeComparable(context.shopifyVariantId);
      return actual.length > 0 && actual === expected
        ? { matched: true, matchedValue: context.shopifyVariantId }
        : { matched: false, matchedValue: null };
    }
    case "sku": {
      const actual = normalizeComparable(context.sku);
      return actual.length > 0 && actual === expected
        ? { matched: true, matchedValue: context.sku }
        : { matched: false, matchedValue: null };
    }
    case "tag": {
      const tags = parseTags(context.tags);
      const matchedTag = tags.find((tag) => tag === expected);
      return matchedTag
        ? { matched: true, matchedValue: matchedTag }
        : { matched: false, matchedValue: null };
    }
    case "vendor": {
      const actual = normalizeComparable(context.vendor);
      return actual.length > 0 && actual === expected
        ? { matched: true, matchedValue: context.vendor }
        : { matched: false, matchedValue: null };
    }
    case "productType": {
      const actual = normalizeComparable(context.productType);
      return actual.length > 0 && actual === expected
        ? { matched: true, matchedValue: context.productType }
        : { matched: false, matchedValue: null };
    }
    case "titleContains": {
      // Merchant-maintained product matcher only — case-insensitive substring match.
      // Not used for return reason classification.
      const title = normalizeComparable(context.title);
      return title.length > 0 && title.includes(expected)
        ? { matched: true, matchedValue: context.title }
        : { matched: false, matchedValue: null };
    }
    case "giftCard":
      return matchesGiftCard(context);
    default:
      return { matched: false, matchedValue: null };
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} exclusionRule
 * @param {Record<string, unknown> | null | undefined} item
 */
export function evaluateProductExclusion(exclusionRule, item) {
  if (!exclusionRule || exclusionRule.enabled === false) {
    return { productExcluded: false };
  }

  if (
    exclusionRule.type &&
    exclusionRule.type !== PRODUCT_EXCLUSION_RULE_TYPE
  ) {
    return { productExcluded: false };
  }

  const parsed = parseProductExclusionConditions(exclusionRule.conditions);
  if (!parsed.ok) {
    return { productExcluded: false };
  }

  const context = buildProductExclusionItemContext(item);

  for (const matcher of parsed.matchers) {
    const result = matcherMatches(matcher, context);
    if (result.matched) {
      return {
        productExcluded: true,
        exclusionReason: matcher.reason?.trim() || DEFAULT_EXCLUSION_REASON,
        exclusionRuleId: matcher.id,
        matchedField: matcher.matcherType,
        matchedValue: result.matchedValue,
      };
    }
  }

  return { productExcluded: false };
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} recoveryRules
 */
export function findProductExclusionRule(recoveryRules) {
  if (!Array.isArray(recoveryRules)) {
    return null;
  }

  return (
    recoveryRules.find(
      (rule) =>
        rule?.type === PRODUCT_EXCLUSION_RULE_TYPE && rule?.enabled !== false,
    ) ?? null
  );
}

/**
 * @param {Array<Record<string, unknown>> | null | undefined} recoveryRules
 */
export function getOfferLadderRules(recoveryRules) {
  if (!Array.isArray(recoveryRules)) {
    return [];
  }

  return recoveryRules.filter(
    (rule) => rule?.type !== PRODUCT_EXCLUSION_RULE_TYPE,
  );
}
