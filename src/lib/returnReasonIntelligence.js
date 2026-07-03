/**
 * Return Reason Intelligence (Task 34 — Prompt 1A + 1B).
 * Pure, deterministic, advisory-only — no LLM, Prisma, network, or policy decisions.
 */

export const NORMALIZED_REASONS = [
  "wrong_size",
  "damaged_item",
  "changed_mind",
  "late_delivery",
  "other",
];

export const STORE_TYPES = [
  "fashion",
  "footwear",
  "jewellery",
  "beauty",
  "skincare",
  "electronics",
  "homeware",
  "furniture",
  "custom",
  "personalised",
  "general",
];

export const QUALITY_ISSUE_TYPES = [
  "defect_issue",
  "damage_issue",
  "material_quality_issue",
  "durability_issue",
  "finish_issue",
  "authenticity_issue",
  "missing_parts_issue",
  "description_mismatch",
  "safety_sensitive_issue",
  "not_quality_related",
];

export const KEYWORD_PRECEDENCE = [
  "safety_sensitive_issue",
  "authenticity_issue",
  "missing_parts_issue",
  "defect_issue",
  "damage_issue",
  "description_mismatch",
  "material_quality_issue",
  "durability_issue",
  "finish_issue",
  "wrong_size",
  "late_delivery",
  "changed_mind",
];

export const KEYWORD_MAPS = {
  safety_sensitive_issue: [
    "caused rash",
    "skin irritation",
    "breakout",
    "burns skin",
    "allergic",
    "irritation",
    "reaction",
    "rash",
  ],
  authenticity_issue: [
    "looks fake",
    "counterfeit",
    "replica",
    "not genuine",
    "fake",
  ],
  missing_parts_issue: [
    "missing accessories",
    "missing accessory",
    "missing parts",
    "missing part",
    "incomplete",
  ],
  defect_issue: [
    "doesn't work",
    "does not work",
    "won't turn on",
    "stopped working",
    "malfunction",
    "not working",
    "defective",
    "defect",
    "faulty",
  ],
  damage_issue: [
    "arrived damaged",
    "arrived cracked",
    "scratched",
    "dented",
    "stained",
    "torn",
    "ripped",
    "cracked",
    "broken",
    "damaged",
  ],
  description_mismatch: [
    "not what was advertised",
    "not what i ordered",
    "wrong item",
    "not what i expected",
    "misleading",
    "looks different",
    "different from photos",
    "different from photo",
    "doesn't match description",
    "does not match description",
    "not described",
    "not as described",
  ],
  material_quality_issue: [
    "low quality",
    "feels cheap",
    "flimsy",
    "thin fabric",
    "bad material",
    "cheap material",
    "cheap quality",
    "poor quality",
  ],
  durability_issue: [
    "sole came off",
    "color faded",
    "colour faded",
    "faded after wash",
    "worn out quickly",
    "fell apart",
    "broke quickly",
    "broke after",
  ],
  finish_issue: [
    "poor finish",
    "paint chipped",
    "uneven",
    "glue marks",
    "bad finish",
    "loose thread",
    "stitching issue",
    "bad stitching",
  ],
  wrong_size: [
    "doesn't fit",
    "does not fit",
    "sizing",
    "size",
    "loose",
    "tight",
    "too large",
    "too big",
    "too small",
  ],
  late_delivery: [
    "shipping took too long",
    "missed event",
    "arrived too late",
    "delayed",
    "late",
  ],
  changed_mind: [
    "style",
    "color",
    "colour",
    "changed my mind",
    "do not like",
    "don't like",
  ],
};

export const STORE_CONTEXT_TAG_MAP = {
  fashion: "fashion_context",
  footwear: "footwear_context",
  jewellery: "jewellery_context",
  beauty: "beauty_context",
  skincare: "skincare_context",
  electronics: "electronics_context",
  homeware: "homeware_context",
  furniture: "furniture_context",
  custom: "custom_product_context",
  personalised: "personalised_product_context",
};

export const STORE_FIT_PHRASES = {
  footwear: [
    "hurts my foot",
    "uncomfortable",
    "painful",
    "rubbing",
    "blister",
    "narrow",
    "wide",
    "hurts",
  ],
  homeware: [
    "too big for my room",
    "too big for the room",
    "doesn't fit space",
    "does not fit space",
    "wrong dimensions",
    "dimensions",
    "room",
    "space",
    "too big",
    "too small",
  ],
  furniture: [
    "too big for my room",
    "too big for the room",
    "doesn't fit space",
    "does not fit space",
    "wrong dimensions",
    "dimensions",
    "room",
    "space",
    "too big",
    "too small",
  ],
  jewellery: ["too small", "too large"],
  fashion: [],
};

const DIMENSION_STORE_TYPES = new Set(["homeware", "furniture"]);

const QUALITY_KEYWORD_TYPES = new Set([
  "safety_sensitive_issue",
  "authenticity_issue",
  "missing_parts_issue",
  "defect_issue",
  "damage_issue",
  "description_mismatch",
  "material_quality_issue",
  "durability_issue",
  "finish_issue",
]);

const STRONG_QUALITY_OVERRIDE_TYPES = new Set([
  "safety_sensitive_issue",
  "authenticity_issue",
  "missing_parts_issue",
  "defect_issue",
  "damage_issue",
  "description_mismatch",
]);

const EXPLICIT_REASON_ALIASES = {
  wrong_size: "wrong_size",
  wrongsize: "wrong_size",
  wrong_fit: "wrong_size",
  ordered_wrong_size: "wrong_size",
  too_small: "wrong_size",
  too_large: "wrong_size",
  damaged_item: "damaged_item",
  damaged: "damaged_item",
  defective: "damaged_item",
  faulty: "damaged_item",
  not_as_described: "damaged_item",
  changed_mind: "changed_mind",
  changedmind: "changed_mind",
  late_delivery: "late_delivery",
  latedelivery: "late_delivery",
  other: "other",
};

const BASE_CLASSIFICATIONS = {
  wrong_size: {
    normalizedReason: "wrong_size",
    reasonGroup: "fit_issue",
    severity: "medium",
    customerIntent: "exchange_likely",
    recoveryOpportunity: "high",
    recommendedNextStep: "offer_exchange_first",
    followUpNeeded: true,
    followUpType: "size_preference",
    merchantInsightTags: ["fit_issue", "exchange_opportunity"],
    qualityIssueType: "not_quality_related",
  },
  damaged_item: {
    normalizedReason: "damaged_item",
    reasonGroup: "quality_issue",
    severity: "high",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "low",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpNeeded: true,
    followUpType: "damage_details",
    merchantInsightTags: ["quality_issue", "manual_review", "damage_issue"],
    qualityIssueType: "damage_issue",
  },
  changed_mind: {
    normalizedReason: "changed_mind",
    reasonGroup: "preference_issue",
    severity: "low",
    customerIntent: "store_credit_possible",
    recoveryOpportunity: "medium",
    recommendedNextStep: "offer_store_credit_or_exchange",
    followUpNeeded: true,
    followUpType: "preference_reason",
    merchantInsightTags: ["preference_issue", "store_credit_opportunity"],
    qualityIssueType: "not_quality_related",
  },
  late_delivery: {
    normalizedReason: "late_delivery",
    reasonGroup: "fulfillment_issue",
    severity: "medium",
    customerIntent: "appeasement_or_credit_possible",
    recoveryOpportunity: "medium",
    recommendedNextStep: "offer_store_credit_with_apology",
    followUpNeeded: false,
    followUpType: null,
    merchantInsightTags: ["fulfillment_issue"],
    qualityIssueType: "not_quality_related",
  },
  other: {
    normalizedReason: "other",
    reasonGroup: "unclear",
    severity: "medium",
    customerIntent: "unknown",
    recoveryOpportunity: "medium",
    recommendedNextStep: "ask_clarifying_question",
    followUpNeeded: true,
    followUpType: "clarify_reason",
    merchantInsightTags: ["needs_clarification"],
    qualityIssueType: "not_quality_related",
  },
};

const QUALITY_CLASSIFICATION_OVERRIDES = {
  safety_sensitive_issue: {
    severity: "high",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "low",
    recommendedNextStep: "manual_review_or_safety_check",
    followUpType: "safety_details",
    merchantInsightTags: [
      "quality_issue",
      "safety_sensitive_issue",
      "safety_sensitive",
      "manual_review",
    ],
  },
  authenticity_issue: {
    severity: "high",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "low",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "authenticity_details",
    merchantInsightTags: [
      "quality_issue",
      "authenticity_issue",
      "manual_review",
    ],
  },
  missing_parts_issue: {
    severity: "high",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "low",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "missing_parts_details",
    merchantInsightTags: [
      "quality_issue",
      "missing_parts_issue",
      "manual_review",
    ],
  },
  defect_issue: {
    severity: "high",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "low",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "fault_details",
    merchantInsightTags: [
      "quality_issue",
      "defect_issue",
      "fault_issue",
      "manual_review",
    ],
  },
  damage_issue: {
    severity: "high",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "low",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "damage_details",
    merchantInsightTags: ["quality_issue", "damage_issue", "manual_review"],
  },
  description_mismatch: {
    severity: "medium",
    customerIntent: "refund_or_exchange_likely",
    recoveryOpportunity: "medium",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "description_mismatch_details",
    merchantInsightTags: [
      "quality_issue",
      "description_mismatch",
      "listing_expectation_issue",
    ],
  },
  material_quality_issue: {
    severity: "medium",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "medium",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "quality_details",
    merchantInsightTags: ["quality_issue", "material_quality_issue"],
  },
  durability_issue: {
    severity: "medium",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "medium",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "quality_details",
    merchantInsightTags: ["quality_issue", "durability_issue"],
  },
  finish_issue: {
    severity: "medium",
    customerIntent: "refund_or_review_likely",
    recoveryOpportunity: "medium",
    recommendedNextStep: "manual_review_or_photo_check",
    followUpType: "quality_details",
    merchantInsightTags: ["quality_issue", "finish_issue"],
  },
};

/**
 * Safely normalize searchable text for keyword matching.
 * @param {unknown} value
 */
export function normalizeSearchText(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {unknown} value
 */
export function normalizeStoreType(value) {
  const normalized = normalizeSearchText(value).replace(/[\s-]+/g, "_");
  if (!normalized) {
    return "general";
  }

  const alias = normalized === "personalized" ? "personalised" : normalized;
  return STORE_TYPES.includes(alias) ? alias : "general";
}

/**
 * @param {unknown} value
 */
export function normalizeProductType(value) {
  const normalized = normalizeSearchText(value);
  return normalized || null;
}

function normalizeReasonToken(value) {
  return normalizeSearchText(value).replace(/[\s-]+/g, "_");
}

/**
 * @param {unknown} reason
 */
export function normalizeExplicitReason(reason) {
  const token = normalizeReasonToken(reason);
  if (!token) {
    return null;
  }

  return EXPLICIT_REASON_ALIASES[token] ?? null;
}

function uniqueTags(tags) {
  return [...new Set(tags.filter(Boolean))];
}

function buildSearchableText(comment, productTitle, productType) {
  return [
    normalizeSearchText(comment),
    normalizeSearchText(productTitle),
    normalizeSearchText(productType),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function phraseMatches(searchableText, phrase) {
  const normalizedPhrase = normalizeSearchText(phrase);
  if (!normalizedPhrase || !searchableText) {
    return false;
  }

  return searchableText.includes(normalizedPhrase);
}

/**
 * @param {string} searchableText
 */
export function detectHighestPrecedenceMatch(searchableText) {
  if (!searchableText) {
    return null;
  }

  for (const matchType of KEYWORD_PRECEDENCE) {
    const phrases = KEYWORD_MAPS[matchType] ?? [];
    const sortedPhrases = [...phrases].sort(
      (left, right) => right.length - left.length,
    );

    for (const phrase of sortedPhrases) {
      if (phraseMatches(searchableText, phrase)) {
        return matchType;
      }
    }
  }

  return null;
}

/**
 * @param {string} searchableText
 * @param {Set<string>} effectiveStoreTypes
 */
export function detectStoreFitMatch(searchableText, effectiveStoreTypes) {
  if (!searchableText || effectiveStoreTypes.size === 0) {
    return null;
  }

  const matches = [];

  for (const storeType of effectiveStoreTypes) {
    const phrases = STORE_FIT_PHRASES[storeType] ?? [];
    const sortedPhrases = [...phrases].sort(
      (left, right) => right.length - left.length,
    );

    for (const phrase of sortedPhrases) {
      if (phraseMatches(searchableText, phrase)) {
        matches.push({
          storeType,
          modifier:
            storeType === "footwear"
              ? "footwear_fit"
              : DIMENSION_STORE_TYPES.has(storeType)
                ? "dimension_fit"
                : "fit",
        });
        break;
      }
    }
  }

  if (matches.length === 0) {
    return null;
  }

  const footwearMatch = matches.find(
    (entry) => entry.modifier === "footwear_fit",
  );
  if (footwearMatch) {
    return footwearMatch.modifier;
  }

  const dimensionMatch = matches.find(
    (entry) => entry.modifier === "dimension_fit",
  );
  if (dimensionMatch) {
    return dimensionMatch.modifier;
  }

  return matches[0].modifier;
}

/**
 * @param {string} searchableText
 * @param {Set<string>} effectiveStoreTypes
 */
export function detectCombinedMatch(searchableText, effectiveStoreTypes) {
  const generalMatch = detectHighestPrecedenceMatch(searchableText);

  if (generalMatch && QUALITY_KEYWORD_TYPES.has(generalMatch)) {
    return {
      detectedMatch: generalMatch,
      storeFitModifier: null,
    };
  }

  const storeFitModifier = detectStoreFitMatch(
    searchableText,
    effectiveStoreTypes,
  );

  if (storeFitModifier) {
    const generalIsWeaker =
      !generalMatch ||
      generalMatch === "wrong_size" ||
      generalMatch === "late_delivery" ||
      generalMatch === "changed_mind";

    if (generalIsWeaker) {
      if (
        storeFitModifier === "dimension_fit" ||
        storeFitModifier === "footwear_fit" ||
        !generalMatch
      ) {
        return {
          detectedMatch: "wrong_size",
          storeFitModifier,
        };
      }
    }
  }

  return {
    detectedMatch: generalMatch,
    storeFitModifier: null,
  };
}

/**
 * @param {string | null} productType
 */
export function inferStoreContextsFromProductType(productType) {
  const normalized = normalizeSearchText(productType);
  if (!normalized) {
    return new Set();
  }

  const inferred = new Set();

  if (/(shoe|sneaker|boot|footwear)/.test(normalized)) {
    inferred.add("footwear");
  }
  if (normalized.includes("furniture")) {
    inferred.add("furniture");
  }
  if (normalized.includes("skincare")) {
    inferred.add("skincare");
  }
  if (normalized.includes("beauty")) {
    inferred.add("beauty");
  }
  if (normalized.includes("custom")) {
    inferred.add("custom");
  }
  if (
    normalized.includes("personalised") ||
    normalized.includes("personalized")
  ) {
    inferred.add("personalised");
  }

  return inferred;
}

/**
 * @param {string} storeType
 * @param {string | null} productType
 */
export function resolveEffectiveStoreContexts(storeType, productType) {
  const contexts = new Set();

  if (storeType !== "general") {
    contexts.add(storeType);
  }

  for (const inferred of inferStoreContextsFromProductType(productType)) {
    contexts.add(inferred);
  }

  return contexts;
}

/**
 * @param {string} storeType
 * @param {string | null} productType
 */
export function resolveProductContextTags(storeType, productType) {
  const tags = [];
  const storeTag = STORE_CONTEXT_TAG_MAP[storeType];
  if (storeTag) {
    tags.push(storeTag);
  }

  const normalizedProductType = normalizeSearchText(productType);
  if (normalizedProductType.includes("custom")) {
    tags.push(STORE_CONTEXT_TAG_MAP.custom);
  }
  if (
    normalizedProductType.includes("personalised") ||
    normalizedProductType.includes("personalized")
  ) {
    tags.push(STORE_CONTEXT_TAG_MAP.personalised);
  }
  if (/(shoe|sneaker|boot|footwear)/.test(normalizedProductType)) {
    tags.push(STORE_CONTEXT_TAG_MAP.footwear);
  }
  if (normalizedProductType.includes("furniture")) {
    tags.push(STORE_CONTEXT_TAG_MAP.furniture);
  }
  if (normalizedProductType.includes("skincare")) {
    tags.push(STORE_CONTEXT_TAG_MAP.skincare);
  }
  if (normalizedProductType.includes("beauty")) {
    tags.push(STORE_CONTEXT_TAG_MAP.beauty);
  }

  return uniqueTags(tags);
}

function hasDimensionStoreContext(effectiveStoreTypes) {
  return [...effectiveStoreTypes].some((storeType) =>
    DIMENSION_STORE_TYPES.has(storeType),
  );
}

function hasFootwearStoreContext(effectiveStoreTypes) {
  return effectiveStoreTypes.has("footwear");
}

function applyStoreTypeModifiers(
  fields,
  { effectiveStoreTypes, storeFitModifier },
) {
  const next = {
    ...fields,
    merchantInsightTags: uniqueTags(fields.merchantInsightTags),
  };

  if (
    hasFootwearStoreContext(effectiveStoreTypes) &&
    next.normalizedReason === "wrong_size" &&
    next.qualityIssueType === "not_quality_related" &&
    (storeFitModifier === "footwear_fit" || storeFitModifier === "fit")
  ) {
    next.followUpType = "size_or_comfort_preference";
    next.merchantInsightTags = uniqueTags([
      ...next.merchantInsightTags,
      "fit_issue",
      "exchange_opportunity",
      "comfort_issue",
    ]);
  }

  if (
    hasDimensionStoreContext(effectiveStoreTypes) &&
    !hasFootwearStoreContext(effectiveStoreTypes) &&
    next.normalizedReason === "wrong_size" &&
    next.qualityIssueType === "not_quality_related"
  ) {
    next.reasonGroup = "dimension_issue";
    next.followUpType = "dimension_preference";
    next.recommendedNextStep = "offer_exchange_first";
    next.merchantInsightTags = uniqueTags([
      ...next.merchantInsightTags,
      "dimension_issue",
      "exchange_opportunity",
    ]);
  }

  if (
    (effectiveStoreTypes.has("custom") ||
      effectiveStoreTypes.has("personalised")) &&
    next.normalizedReason === "changed_mind" &&
    next.qualityIssueType === "not_quality_related"
  ) {
    next.recoveryOpportunity = "low";
    next.recommendedNextStep = "check_policy_before_offer";
    next.merchantInsightTags = uniqueTags([
      ...next.merchantInsightTags,
      "policy_sensitive",
    ]);
  }

  return next;
}

function canQualityOverrideExplicitReason(explicitReason, detectedType) {
  if (
    !explicitReason ||
    explicitReason === "other" ||
    explicitReason === "changed_mind"
  ) {
    return true;
  }

  if (explicitReason === "damaged_item") {
    return QUALITY_KEYWORD_TYPES.has(detectedType);
  }

  if (explicitReason === "wrong_size") {
    return STRONG_QUALITY_OVERRIDE_TYPES.has(detectedType);
  }

  if (explicitReason === "late_delivery") {
    return detectedType === "safety_sensitive_issue";
  }

  return false;
}

function resolveClassification(
  explicitReason,
  detectedMatch,
  storeFitModifier,
) {
  let normalizedReason = explicitReason ?? "other";
  let qualityIssueType = "not_quality_related";
  let keywordInferred = false;
  let keywordOverride = false;

  if (!detectedMatch) {
    if (normalizedReason === "damaged_item") {
      qualityIssueType = "damage_issue";
    }
    return {
      normalizedReason,
      qualityIssueType,
      keywordInferred,
      keywordOverride,
      storeFitModifier: null,
    };
  }

  if (QUALITY_KEYWORD_TYPES.has(detectedMatch)) {
    if (!explicitReason) {
      normalizedReason = "damaged_item";
      qualityIssueType = detectedMatch;
      keywordInferred = true;
    } else if (explicitReason === "damaged_item") {
      qualityIssueType = detectedMatch;
    } else if (
      canQualityOverrideExplicitReason(explicitReason, detectedMatch)
    ) {
      normalizedReason = "damaged_item";
      qualityIssueType = detectedMatch;
      keywordOverride = true;
    }
  } else if (detectedMatch === "wrong_size") {
    if (!explicitReason || explicitReason === "other") {
      normalizedReason = "wrong_size";
      keywordInferred = true;
    } else if (explicitReason === "changed_mind" && storeFitModifier != null) {
      normalizedReason = "wrong_size";
      keywordOverride = true;
    }
  } else if (detectedMatch === "late_delivery") {
    if (!explicitReason || explicitReason === "other") {
      normalizedReason = "late_delivery";
      keywordInferred = true;
    } else if (
      explicitReason === "late_delivery" &&
      detectedMatch === "late_delivery"
    ) {
      normalizedReason = "late_delivery";
    }
  } else if (detectedMatch === "changed_mind") {
    if (!explicitReason || explicitReason === "other") {
      normalizedReason = "changed_mind";
      keywordInferred = true;
    }
  }

  if (
    normalizedReason === "damaged_item" &&
    qualityIssueType === "not_quality_related"
  ) {
    qualityIssueType = "damage_issue";
  }

  return {
    normalizedReason,
    qualityIssueType,
    keywordInferred,
    keywordOverride,
    storeFitModifier,
  };
}

function resolveConfidence({
  explicitReason,
  normalizedReason,
  qualityIssueType,
  keywordInferred,
  keywordOverride,
}) {
  if (
    normalizedReason === "other" &&
    !keywordInferred &&
    !keywordOverride &&
    !explicitReason
  ) {
    return 0.55;
  }

  if (
    explicitReason === "other" &&
    normalizedReason === "other" &&
    !keywordInferred &&
    !keywordOverride
  ) {
    return 0.55;
  }

  if (keywordOverride) {
    return 0.8;
  }

  if (keywordInferred && !explicitReason) {
    return 0.8;
  }

  if (explicitReason && explicitReason === normalizedReason) {
    if (
      explicitReason === "damaged_item" &&
      qualityIssueType !== "not_quality_related"
    ) {
      return 0.95;
    }
    return 0.95;
  }

  if (keywordInferred) {
    return 0.8;
  }

  return 0.55;
}

function buildResultFields(normalizedReason, qualityIssueType) {
  const base = { ...BASE_CLASSIFICATIONS[normalizedReason] };

  if (qualityIssueType !== "not_quality_related") {
    const qualityOverride = QUALITY_CLASSIFICATION_OVERRIDES[qualityIssueType];
    return {
      ...base,
      normalizedReason: "damaged_item",
      reasonGroup: "quality_issue",
      followUpNeeded: true,
      qualityIssueType,
      ...qualityOverride,
      merchantInsightTags: uniqueTags(qualityOverride.merchantInsightTags),
    };
  }

  return {
    ...base,
    merchantInsightTags: uniqueTags(base.merchantInsightTags),
  };
}

/**
 * Analyze a return reason with deterministic keyword intelligence.
 * Advisory only — does not decide eligibility, refunds, or legal outcomes.
 *
 * @param {{
 *   reason?: string | null;
 *   comment?: string | null;
 *   productTitle?: string | null;
 *   productType?: string | null;
 *   storeType?: string | null;
 *   recoveryOption?: string | null;
 * }} input
 */
export function analyzeReturnReason(input = {}) {
  const {
    reason = null,
    comment = null,
    productTitle = null,
    productType = null,
    storeType = null,
    recoveryOption: _recoveryOption = null,
  } = input ?? {};

  const inputReason = reason == null ? "" : String(reason);
  const explicitReason = normalizeExplicitReason(reason);
  const normalizedStoreType = normalizeStoreType(storeType);
  const normalizedProductType = normalizeProductType(productType);
  const effectiveStoreTypes = resolveEffectiveStoreContexts(
    normalizedStoreType,
    normalizedProductType,
  );
  const productContextTags = resolveProductContextTags(
    normalizedStoreType,
    normalizedProductType,
  );
  const searchableText = buildSearchableText(
    comment,
    productTitle,
    productType,
  );
  const { detectedMatch, storeFitModifier } = detectCombinedMatch(
    searchableText,
    effectiveStoreTypes,
  );
  const classification = resolveClassification(
    explicitReason,
    detectedMatch,
    storeFitModifier,
  );
  const baseFields = buildResultFields(
    classification.normalizedReason,
    classification.qualityIssueType,
  );
  const fields = applyStoreTypeModifiers(baseFields, {
    effectiveStoreTypes,
    storeFitModifier: classification.storeFitModifier,
  });
  const confidence = resolveConfidence({
    explicitReason,
    normalizedReason: classification.normalizedReason,
    qualityIssueType: classification.qualityIssueType,
    keywordInferred: classification.keywordInferred,
    keywordOverride: classification.keywordOverride,
  });

  return {
    inputReason,
    normalizedReason: fields.normalizedReason,
    reasonGroup: fields.reasonGroup,
    severity: fields.severity,
    customerIntent: fields.customerIntent,
    recoveryOpportunity: fields.recoveryOpportunity,
    recommendedNextStep: fields.recommendedNextStep,
    followUpNeeded: fields.followUpNeeded,
    followUpType: fields.followUpType,
    merchantInsightTags: fields.merchantInsightTags,
    confidence,
    storeType: normalizedStoreType,
    productType: normalizedProductType,
    productContextTags,
    qualityIssueType: fields.qualityIssueType,
  };
}
