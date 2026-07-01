/**
 * Dynamic Offer Ladder Engine (Task 33).
 * Pure, deterministic, recommendation-only — no Shopify actions, refunds,
 * payments, inventory changes, store credit creation, DB writes, or fetch calls.
 */

export const OFFER_TYPES = {
  EXCHANGE: "exchange",
  STORE_CREDIT: "store_credit",
  PARTIAL_REFUND: "partial_refund",
  MANUAL_REVIEW: "manual_review",
};

export const OFFER_LADDER_ENGINE_VERSION = "dynamic_offer_ladder_v1";

const ALL_OFFER_TYPES = [
  OFFER_TYPES.EXCHANGE,
  OFFER_TYPES.STORE_CREDIT,
  OFFER_TYPES.PARTIAL_REFUND,
  OFFER_TYPES.MANUAL_REVIEW,
];

const LEGAL_ISSUE_REASONS = new Set([
  "damaged_item",
  "defective",
  "faulty",
  "not_as_described",
]);

const REASON_RANKINGS = {
  wrong_size: [
    OFFER_TYPES.EXCHANGE,
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.PARTIAL_REFUND,
    OFFER_TYPES.MANUAL_REVIEW,
  ],
  wrong_fit: [
    OFFER_TYPES.EXCHANGE,
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.PARTIAL_REFUND,
    OFFER_TYPES.MANUAL_REVIEW,
  ],
  changed_mind: [
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.EXCHANGE,
    OFFER_TYPES.PARTIAL_REFUND,
    OFFER_TYPES.MANUAL_REVIEW,
  ],
  damaged_item: [
    OFFER_TYPES.MANUAL_REVIEW,
    OFFER_TYPES.EXCHANGE,
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.PARTIAL_REFUND,
  ],
  defective: [
    OFFER_TYPES.MANUAL_REVIEW,
    OFFER_TYPES.EXCHANGE,
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.PARTIAL_REFUND,
  ],
  faulty: [
    OFFER_TYPES.MANUAL_REVIEW,
    OFFER_TYPES.EXCHANGE,
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.PARTIAL_REFUND,
  ],
  not_as_described: [
    OFFER_TYPES.MANUAL_REVIEW,
    OFFER_TYPES.EXCHANGE,
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.PARTIAL_REFUND,
  ],
  late_delivery: [
    OFFER_TYPES.PARTIAL_REFUND,
    OFFER_TYPES.STORE_CREDIT,
    OFFER_TYPES.MANUAL_REVIEW,
    OFFER_TYPES.EXCHANGE,
  ],
};

const DEFAULT_RANKING = [
  OFFER_TYPES.STORE_CREDIT,
  OFFER_TYPES.EXCHANGE,
  OFFER_TYPES.MANUAL_REVIEW,
  OFFER_TYPES.PARTIAL_REFUND,
];

const POLICY_BLOCK_TOKENS = new Set([
  "NOT_ELIGIBLE",
  "INELIGIBLE",
  "BLOCKED",
  "DISALLOWED",
  "NOT_RETURNABLE",
]);

const OFFER_METADATA = {
  [OFFER_TYPES.EXCHANGE]: {
    title: "Exchange",
    recoveryIntent: "retain_revenue_via_exchange",
    defaultCustomerMessage:
      "Exchange this item for another size or option that works better for you.",
    merchantReason:
      "Exchange recommended to retain revenue while resolving fit issues.",
  },
  [OFFER_TYPES.STORE_CREDIT]: {
    title: "Store credit",
    recoveryIntent: "retain_revenue_via_store_credit",
    defaultCustomerMessage:
      "Receive store credit you can use on a future purchase.",
    merchantReason: "Store credit recommended to retain future revenue.",
  },
  [OFFER_TYPES.PARTIAL_REFUND]: {
    title: "Partial refund",
    recoveryIntent: "partial_revenue_recovery",
    defaultCustomerMessage:
      "A partial refund may be available after the store reviews your request.",
    merchantReason:
      "Partial refund may be appropriate when full recovery options are not suitable.",
  },
  [OFFER_TYPES.MANUAL_REVIEW]: {
    title: "Merchant review",
    recoveryIntent: "human_review_required",
    defaultCustomerMessage:
      "The store will review your request and confirm the available options.",
    merchantReason: "Manual review required before any recovery action.",
  },
};

const LEGAL_MANUAL_REVIEW_MESSAGE =
  "We're sorry this item arrived with an issue. We'll review the details and photos so the store can offer the right resolution.";

const EXCLUSION_MANUAL_REVIEW_MESSAGE =
  "This item may have special return conditions, so the store will review your request before confirming the available options.";

function normalizeReason(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeToken(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function asBoolean(value, fallback = true) {
  if (value == null) {
    return fallback;
  }

  return value !== false;
}

function getRankingForReason(reasonKey) {
  return REASON_RANKINGS[reasonKey] ?? DEFAULT_RANKING;
}

function scoreForRank(rank, enabled) {
  if (!enabled) {
    return 0;
  }

  return 100 - (rank - 1) * 10;
}

function buildStoreCreditMessage(bonusPercent) {
  const bonus = Number(bonusPercent);
  if (!Number.isFinite(bonus) || bonus <= 0) {
    return OFFER_METADATA[OFFER_TYPES.STORE_CREDIT].defaultCustomerMessage;
  }

  return `Receive store credit with a ${bonus}% bonus you can use on a future purchase.`;
}

function buildManualReviewMessage(reasonKey, blockKind) {
  if (blockKind === "exclusion") {
    return EXCLUSION_MANUAL_REVIEW_MESSAGE;
  }

  if (LEGAL_ISSUE_REASONS.has(reasonKey)) {
    return LEGAL_MANUAL_REVIEW_MESSAGE;
  }

  return OFFER_METADATA[OFFER_TYPES.MANUAL_REVIEW].defaultCustomerMessage;
}

function mergeMerchantRules(explicitRules, recoveryRules) {
  const fromRecovery = normalizeMerchantOfferRules(recoveryRules);
  const explicit = explicitRules ?? {};

  return {
    exchangeEnabled: asBoolean(
      explicit.exchangeEnabled,
      fromRecovery.exchangeEnabled,
    ),
    storeCreditEnabled: asBoolean(
      explicit.storeCreditEnabled,
      fromRecovery.storeCreditEnabled,
    ),
    partialRefundEnabled: asBoolean(
      explicit.partialRefundEnabled,
      fromRecovery.partialRefundEnabled,
    ),
    manualReviewEnabled: true,
    maxPartialRefundPercent:
      explicit.maxPartialRefundPercent ?? fromRecovery.maxPartialRefundPercent,
    storeCreditBonusPercent:
      explicit.storeCreditBonusPercent ?? fromRecovery.storeCreditBonusPercent,
  };
}

function isLegalReviewRequired(policyDecision) {
  if (!policyDecision || typeof policyDecision !== "object") {
    return false;
  }

  const status = normalizeToken(policyDecision.status);
  const decision = normalizeToken(policyDecision.decision);

  return (
    status === "LEGAL_REVIEW_REQUIRED" || decision === "LEGAL_REVIEW_REQUIRED"
  );
}

function isPolicyBlocked(policyDecision) {
  if (!policyDecision || typeof policyDecision !== "object") {
    return false;
  }

  if (isLegalReviewRequired(policyDecision)) {
    return false;
  }

  if (policyDecision.eligible === false) {
    return true;
  }

  if (policyDecision.returnable === false) {
    return true;
  }

  const tokens = [
    normalizeToken(policyDecision.status),
    normalizeToken(policyDecision.decision),
    normalizeToken(policyDecision.reason),
  ];

  return tokens.some((token) => POLICY_BLOCK_TOKENS.has(token));
}

function getPolicyBlockedReason(policyDecision) {
  const status = normalizeToken(policyDecision?.status);
  const decision = normalizeToken(policyDecision?.decision);
  const reason = normalizeToken(policyDecision?.reason);

  if (POLICY_BLOCK_TOKENS.has(status)) {
    return status.toLowerCase();
  }

  if (POLICY_BLOCK_TOKENS.has(decision)) {
    return decision.toLowerCase();
  }

  if (POLICY_BLOCK_TOKENS.has(reason)) {
    return reason.toLowerCase();
  }

  if (policyDecision?.eligible === false) {
    return "not_eligible";
  }

  if (policyDecision?.returnable === false) {
    return "not_returnable";
  }

  return "policy_blocked";
}

function isExclusionBlocked(exclusionDecision) {
  if (!exclusionDecision || typeof exclusionDecision !== "object") {
    return false;
  }

  if (exclusionDecision.productExcluded === true) {
    return true;
  }

  if (exclusionDecision.excluded === true) {
    return true;
  }

  if (exclusionDecision.blocked === true) {
    return true;
  }

  const status = normalizeToken(exclusionDecision.status);
  const reason = normalizeToken(exclusionDecision.reason);

  const exclusionTokens = new Set([
    "EXCLUDED",
    "BLOCKED",
    "FINAL_SALE",
    "HYGIENE_BLOCKED",
    "NON_RETURNABLE",
    "DISALLOWED",
    "PRODUCT_EXCLUDED",
  ]);

  return exclusionTokens.has(status) || exclusionTokens.has(reason);
}

function getExclusionBlockedReason(exclusionDecision) {
  const status = normalizeToken(exclusionDecision?.status);
  const reason = normalizeToken(exclusionDecision?.reason);

  if (status === "FINAL_SALE" || reason === "FINAL_SALE") {
    return "final_sale";
  }

  if (status === "HYGIENE_BLOCKED" || reason === "HYGIENE_BLOCKED") {
    return "hygiene_blocked";
  }

  if (
    status === "NON_RETURNABLE" ||
    reason === "NON_RETURNABLE" ||
    exclusionDecision?.nonReturnable === true
  ) {
    return "non_returnable";
  }

  if (exclusionDecision?.productExcluded === true) {
    return "product_excluded";
  }

  return "product_excluded";
}

function isRecoveryManualReviewRequired(recoveryDecision) {
  if (!recoveryDecision || typeof recoveryDecision !== "object") {
    return false;
  }

  return (
    recoveryDecision.manualReviewRequired === true ||
    recoveryDecision.requiresManualReview === true ||
    normalizeToken(recoveryDecision.status) === "MANUAL_REVIEW_REQUIRED"
  );
}

function buildOfferSkeleton(type, rank, reasonKey, blockKind, merchantRules) {
  const meta = OFFER_METADATA[type];
  let customerMessage = meta.defaultCustomerMessage;

  if (type === OFFER_TYPES.MANUAL_REVIEW) {
    customerMessage = buildManualReviewMessage(reasonKey, blockKind);
  }

  if (type === OFFER_TYPES.STORE_CREDIT) {
    customerMessage = buildStoreCreditMessage(
      merchantRules.storeCreditBonusPercent,
    );
  }

  const offer = {
    type,
    rank,
    title: meta.title,
    customerMessage,
    merchantReason: meta.merchantReason,
    recoveryIntent: meta.recoveryIntent,
    requiresMerchantApproval: true,
    score: 0,
    enabled: true,
  };

  const bonus = Number(merchantRules.storeCreditBonusPercent);
  if (
    type === OFFER_TYPES.STORE_CREDIT &&
    Number.isFinite(bonus) &&
    bonus > 0
  ) {
    offer.incentive = {
      type: "bonus_credit",
      percent: bonus,
    };
  }

  return offer;
}

function disableOffer(offer) {
  return {
    ...offer,
    enabled: false,
    score: 0,
  };
}

function applyOnlyManualReviewEnabled(offers, blockKind, reasonKey) {
  return offers.map((offer) => {
    if (offer.type === OFFER_TYPES.MANUAL_REVIEW) {
      return {
        ...offer,
        enabled: true,
        customerMessage: buildManualReviewMessage(reasonKey, blockKind),
        score: scoreForRank(offer.rank, true),
      };
    }

    return disableOffer(offer);
  });
}

function applyMerchantGates(offers, merchantRules, auditReasons) {
  const gateMap = {
    [OFFER_TYPES.EXCHANGE]: {
      enabled: merchantRules.exchangeEnabled,
      audit: "merchant:exchange_disabled",
    },
    [OFFER_TYPES.STORE_CREDIT]: {
      enabled: merchantRules.storeCreditEnabled,
      audit: "merchant:store_credit_disabled",
    },
    [OFFER_TYPES.PARTIAL_REFUND]: {
      enabled: merchantRules.partialRefundEnabled,
      audit: "merchant:partial_refund_disabled",
    },
    [OFFER_TYPES.MANUAL_REVIEW]: {
      enabled: true,
      audit: null,
    },
  };

  return offers.map((offer) => {
    const gate = gateMap[offer.type];
    if (!gate || gate.enabled) {
      return offer;
    }

    if (gate.audit) {
      auditReasons.push(gate.audit);
    }

    return disableOffer(offer);
  });
}

function applyPartialRefundPercentGate(offers, merchantRules, auditReasons) {
  const maxPercent = Number(merchantRules.maxPartialRefundPercent);
  if (Number.isFinite(maxPercent) && maxPercent > 0) {
    return offers;
  }

  return offers.map((offer) => {
    if (offer.type !== OFFER_TYPES.PARTIAL_REFUND || !offer.enabled) {
      return offer;
    }

    auditReasons.push("merchant:max_partial_refund_percent_zero");
    return disableOffer(offer);
  });
}

function applyExchangeStockGate(offers, context, auditReasons) {
  const stockAvailable = context?.exchangeStockAvailable;

  if (stockAvailable === false) {
    auditReasons.push("exchange:stock_unavailable");
    return offers.map((offer) => {
      if (offer.type !== OFFER_TYPES.EXCHANGE) {
        return offer;
      }

      return disableOffer(offer);
    });
  }

  const hasExchange = offers.some(
    (offer) => offer.type === OFFER_TYPES.EXCHANGE,
  );
  if (hasExchange && stockAvailable == null) {
    auditReasons.push("exchange:stock_unknown");
  }

  return offers;
}

function ensureManualReviewPrimary(offers) {
  const manualReview = offers.find(
    (offer) => offer.type === OFFER_TYPES.MANUAL_REVIEW,
  );
  if (!manualReview) {
    return offers;
  }

  const others = offers
    .filter((offer) => offer.type !== OFFER_TYPES.MANUAL_REVIEW)
    .sort((left, right) => left.rank - right.rank);

  const reordered = [
    { ...manualReview, rank: 1, enabled: true },
    ...others.map((offer, index) => ({
      ...offer,
      rank: index + 2,
    })),
  ];

  return reordered;
}

function finalizeOffers(offers) {
  const scored = offers.map((offer) => ({
    ...offer,
    score: scoreForRank(offer.rank, offer.enabled),
  }));

  return scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.rank - right.rank;
  });
}

/**
 * Defensively map Task 30 RecoveryRule-like rows into flat merchant offer gates.
 * @param {Array<Record<string, unknown>> | { rules?: Array<Record<string, unknown>> } | null | undefined} recoveryRulesOrRules
 */
export function normalizeMerchantOfferRules(recoveryRulesOrRules) {
  const defaults = {
    exchangeEnabled: true,
    storeCreditEnabled: true,
    partialRefundEnabled: false,
    manualReviewEnabled: true,
    maxPartialRefundPercent: 0,
    storeCreditBonusPercent: 0,
  };

  if (recoveryRulesOrRules == null) {
    return defaults;
  }

  const rules = Array.isArray(recoveryRulesOrRules)
    ? recoveryRulesOrRules
    : Array.isArray(recoveryRulesOrRules.rules)
      ? recoveryRulesOrRules.rules
      : [];

  if (rules.length === 0) {
    return defaults;
  }

  const result = { ...defaults };

  for (const rule of rules) {
    if (!rule || typeof rule !== "object") {
      continue;
    }

    const type = normalizeToken(rule.type);
    const enabled = rule.enabled !== false;
    const actions =
      rule.actions && typeof rule.actions === "object" ? rule.actions : {};

    switch (type) {
      case "EXCHANGE":
        result.exchangeEnabled = enabled;
        break;
      case "STORE_CREDIT":
        result.storeCreditEnabled = enabled;
        if (actions.bonusPercent != null) {
          const bonus = Number(actions.bonusPercent);
          if (Number.isFinite(bonus) && bonus >= 0) {
            result.storeCreditBonusPercent = bonus;
          }
        }
        break;
      case "PARTIAL_REFUND":
        result.partialRefundEnabled = enabled;
        if (actions.maxRefundPercent != null) {
          const maxPercent = Number(actions.maxRefundPercent);
          if (Number.isFinite(maxPercent) && maxPercent >= 0) {
            result.maxPartialRefundPercent = maxPercent;
          }
        }
        break;
      case "MANUAL_REVIEW":
        result.manualReviewEnabled = enabled;
        break;
      default:
        break;
    }
  }

  return result;
}

/**
 * Build a ranked dynamic offer ladder for one return item.
 * @param {Record<string, unknown> | null | undefined} input
 */
export function buildDynamicOfferLadder(input) {
  const auditReasons = [];
  const safeInput = input ?? {};
  const {
    customerReason = null,
    policyDecision = null,
    exclusionDecision = null,
    recoveryDecision = null,
    merchantRules: explicitMerchantRules = null,
    recoveryRules = null,
    context = null,
  } = safeInput;

  const reasonKey = normalizeReason(customerReason);
  const merchantRules = mergeMerchantRules(
    explicitMerchantRules,
    recoveryRules,
  );
  const ranking = getRankingForReason(reasonKey);

  const rankByType = new Map(ranking.map((type, index) => [type, index + 1]));

  let offers = ALL_OFFER_TYPES.map((type) =>
    buildOfferSkeleton(
      type,
      rankByType.get(type) ?? ranking.length + 1,
      reasonKey,
      null,
      merchantRules,
    ),
  );

  let manualReviewRequired = false;
  let blockedReason = null;
  let blockKind = null;

  if (isLegalReviewRequired(policyDecision)) {
    manualReviewRequired = true;
    blockedReason = "legal_review_required";
    blockKind = "legal";
    auditReasons.push("policy:legal_review_required");
    offers = applyOnlyManualReviewEnabled(offers, blockKind, reasonKey);
  } else if (isPolicyBlocked(policyDecision)) {
    manualReviewRequired = true;
    blockedReason = getPolicyBlockedReason(policyDecision);
    blockKind = "policy";
    auditReasons.push(`policy:${blockedReason}`);
    offers = applyOnlyManualReviewEnabled(offers, blockKind, reasonKey);
  } else if (isExclusionBlocked(exclusionDecision)) {
    manualReviewRequired = true;
    blockedReason = getExclusionBlockedReason(exclusionDecision);
    blockKind = "exclusion";
    auditReasons.push(`exclusion:${blockedReason}`);
    offers = applyOnlyManualReviewEnabled(offers, blockKind, reasonKey);
  } else {
    offers = applyMerchantGates(offers, merchantRules, auditReasons);
    offers = applyPartialRefundPercentGate(offers, merchantRules, auditReasons);
    offers = applyExchangeStockGate(offers, context, auditReasons);

    if (isRecoveryManualReviewRequired(recoveryDecision)) {
      manualReviewRequired = true;
      auditReasons.push("recovery:manual_review_required");
      offers = ensureManualReviewPrimary(offers);
    }
  }

  offers = finalizeOffers(offers);
  const primaryOffer = offers.find((offer) => offer.enabled) ?? null;

  return {
    engineVersion: OFFER_LADDER_ENGINE_VERSION,
    primaryOffer,
    offers,
    manualReviewRequired,
    blockedReason,
    auditReasons,
  };
}
