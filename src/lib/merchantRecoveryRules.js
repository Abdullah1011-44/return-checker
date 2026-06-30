import { z } from "zod";
import { safeString } from "@/lib/validation";

/**
 * Recovery preference layers in this project:
 *
 * 1. Merchant / MerchantSettings booleans — coarse master switches shown in the
 *    current settings UI (allowExchange, allowStoreCredit, etc.).
 * 2. MerchantRecoveryRule — future offer-ladder preference source of truth
 *    (one row per merchant + type, ordered by priority).
 * 3. Task 30 only stores preferences. Task 31+ will evaluate these rules against
 *    return context. Nothing here executes refunds, calls Shopify, or changes
 *    submit-return / returnScoring behavior.
 */

export const RECOVERY_RULE_TYPES = [
  "EXCHANGE",
  "STORE_CREDIT",
  "PARTIAL_REFUND",
  "MANUAL_REVIEW",
];

export const DISALLOWED_RECOVERY_RULE_TYPES = [
  "REFUND",
  "FULL_REFUND",
  "DISCOUNT_TO_KEEP",
];

export const MERCHANT_RECOVERY_RULES_UPDATED_ACTION =
  "MERCHANT_RECOVERY_RULES_UPDATED";

const FORBIDDEN_CONDITION_KEYS = new Set([
  "customerEmail",
  "email",
  "phone",
  "address",
  "customerName",
  "orderNumber",
  "accessToken",
  "imageUrl",
  "imageUrls",
]);

const recoveryRuleTypeSchema = z.enum(RECOVERY_RULE_TYPES, {
  message: "type must be EXCHANGE, STORE_CREDIT, PARTIAL_REFUND, or MANUAL_REVIEW.",
});

const recoveryRuleConditionsSchema = z
  .object({
    minOrderValue: z.number().min(0).optional(),
    maxOrderValue: z.number().min(0).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !Object.keys(value).some((key) => FORBIDDEN_CONDITION_KEYS.has(key)),
    { message: "conditions contain disallowed fields." }
  )
  .refine(
    (value) =>
      value.minOrderValue == null ||
      value.maxOrderValue == null ||
      value.maxOrderValue >= value.minOrderValue,
    {
      message: "maxOrderValue must be greater than or equal to minOrderValue.",
    }
  );

const recoveryRuleActionsSchema = z
  .object({
    message: safeString(240).optional(),
    bonusPercent: z.number().int().min(0).max(100).optional(),
    maxRefundPercent: z.number().int().min(1).max(100).optional(),
    requiresApproval: z.boolean().optional(),
    autoRefund: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => value.autoRefund !== true, {
    message: "autoRefund is not allowed on recovery rules.",
  });

export const merchantRecoveryRuleInputSchema = z
  .object({
    type: recoveryRuleTypeSchema,
    name: safeString(80).min(1, { message: "name is required." }),
    enabled: z.boolean({ message: "enabled must be a boolean." }),
    priority: z
      .number({ message: "priority must be an integer." })
      .int({ message: "priority must be an integer." })
      .min(1, { message: "priority must be at least 1." })
      .max(999, { message: "priority must be at most 999." }),
    conditions: recoveryRuleConditionsSchema,
    actions: recoveryRuleActionsSchema,
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.type === "PARTIAL_REFUND" && rule.actions.requiresApproval === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PARTIAL_REFUND rules must require merchant approval.",
        path: ["actions", "requiresApproval"],
      });
    }
  });

export const merchantRecoveryRulesPutSchema = z
  .object({
    rules: z
      .array(merchantRecoveryRuleInputSchema)
      .min(1, { message: "At least one rule is required." })
      .max(4, { message: "At most four rules are allowed." }),
  })
  .strict()
  .superRefine((body, ctx) => {
    const types = body.rules.map((rule) => rule.type);
    const priorities = body.rules.map((rule) => rule.priority);

    if (new Set(types).size !== types.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate rule types are not allowed.",
        path: ["rules"],
      });
    }

    if (new Set(priorities).size !== priorities.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate priority values are not allowed.",
        path: ["rules"],
      });
    }

    for (const disallowed of DISALLOWED_RECOVERY_RULE_TYPES) {
      if (types.includes(disallowed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Rule type ${disallowed} is not allowed.`,
          path: ["rules"],
        });
      }
    }

    for (const requiredType of RECOVERY_RULE_TYPES) {
      if (!types.includes(requiredType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `All four rule types are required. Missing ${requiredType}.`,
          path: ["rules"],
        });
      }
    }
  });

export const DEFAULT_MERCHANT_RECOVERY_RULES = [
  {
    type: "EXCHANGE",
    name: "Exchange",
    enabled: true,
    priority: 1,
    conditions: {},
    actions: {
      message: "Offer an exchange first when appropriate.",
    },
  },
  {
    type: "STORE_CREDIT",
    name: "Store credit",
    enabled: true,
    priority: 2,
    conditions: {},
    actions: {
      bonusPercent: 0,
      message: "Offer store credit as a revenue-saving option.",
    },
  },
  {
    type: "PARTIAL_REFUND",
    name: "Partial refund",
    enabled: false,
    priority: 3,
    conditions: {},
    actions: {
      maxRefundPercent: 20,
      requiresApproval: true,
      message:
        "Partial refund requires merchant approval and is never automatic.",
    },
  },
  {
    type: "MANUAL_REVIEW",
    name: "Manual review",
    enabled: true,
    priority: 4,
    conditions: {},
    actions: {
      message:
        "Send the request to manual review when automated recovery is not suitable.",
    },
  },
];

function normalizePartialRefundActions(actions, type) {
  if (type !== "PARTIAL_REFUND") {
    return actions;
  }

  return {
    ...actions,
    requiresApproval: true,
  };
}

/**
 * @param {import("@prisma/client").MerchantRecoveryRule} rule
 */
export function serializeMerchantRecoveryRule(rule) {
  return {
    id: rule.id,
    type: rule.type,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    conditions: rule.conditions ?? {},
    actions: rule.actions ?? {},
    updatedAt: rule.updatedAt.toISOString(),
  };
}

function summarizeRuleForAudit(rule) {
  return {
    id: rule.id,
    type: rule.type,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    conditions: rule.conditions ?? {},
    actions: rule.actions ?? {},
  };
}

/**
 * @param {import("@prisma/client").MerchantRecoveryRule[]} beforeRules
 * @param {import("@prisma/client").MerchantRecoveryRule[]} afterRules
 */
export function buildRecoveryRulesAuditMetadata(beforeRules, afterRules) {
  const beforeByType = new Map(beforeRules.map((rule) => [rule.type, rule]));
  const afterByType = new Map(afterRules.map((rule) => [rule.type, rule]));
  const changedFields = [];
  const before = [];
  const after = [];

  for (const type of RECOVERY_RULE_TYPES) {
    const beforeRule = beforeByType.get(type);
    const afterRule = afterByType.get(type);

    if (!beforeRule && !afterRule) {
      continue;
    }

    const beforeSummary = beforeRule ? summarizeRuleForAudit(beforeRule) : null;
    const afterSummary = afterRule ? summarizeRuleForAudit(afterRule) : null;

    if (JSON.stringify(beforeSummary) !== JSON.stringify(afterSummary)) {
      changedFields.push(type);
      if (beforeSummary) {
        before.push(beforeSummary);
      }
      if (afterSummary) {
        after.push(afterSummary);
      }
    }
  }

  const latestUpdatedAt = afterRules.reduce((latest, rule) => {
    const time = rule.updatedAt?.getTime?.() ?? 0;
    return time > latest ? time : latest;
  }, 0);

  return {
    action: MERCHANT_RECOVERY_RULES_UPDATED_ACTION,
    changedFields,
    before,
    after,
    updatedAt: latestUpdatedAt
      ? new Date(latestUpdatedAt).toISOString()
      : new Date().toISOString(),
  };
}

function sortRulesByPriority(rules) {
  return [...rules].sort((left, right) => left.priority - right.priority);
}

/**
 * Seed default rules idempotently (merchantId + type upsert).
 *
 * @param {string} merchantId
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} prismaClient
 */
export async function ensureDefaultMerchantRecoveryRules(
  merchantId,
  prismaClient
) {
  for (const template of DEFAULT_MERCHANT_RECOVERY_RULES) {
    await prismaClient.merchantRecoveryRule.upsert({
      where: {
        merchantId_type: {
          merchantId,
          type: template.type,
        },
      },
      create: {
        merchantId,
        type: template.type,
        name: template.name,
        enabled: template.enabled,
        priority: template.priority,
        conditions: template.conditions,
        actions: normalizePartialRefundActions(template.actions, template.type),
      },
      update: {},
    });
  }

  const rules = await prismaClient.merchantRecoveryRule.findMany({
    where: { merchantId },
  });

  return sortRulesByPriority(rules);
}

/**
 * @param {string} merchantId
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} prismaClient
 */
export async function listMerchantRecoveryRules(merchantId, prismaClient) {
  const rules = await prismaClient.merchantRecoveryRule.findMany({
    where: { merchantId },
  });

  if (rules.length === 0) {
    return ensureDefaultMerchantRecoveryRules(merchantId, prismaClient);
  }

  return sortRulesByPriority(rules);
}

/**
 * @param {string} merchantId
 * @param {z.infer<typeof merchantRecoveryRuleInputSchema>[]} rulesInput
 * @param {import("@prisma/client").PrismaClient} prismaClient
 */
export async function upsertMerchantRecoveryRules(
  merchantId,
  rulesInput,
  prismaClient
) {
  return prismaClient.$transaction(async (tx) => {
    const existing = await tx.merchantRecoveryRule.findMany({
      where: { merchantId },
    });

    for (const ruleInput of rulesInput) {
      const actions = normalizePartialRefundActions(
        ruleInput.actions,
        ruleInput.type
      );

      await tx.merchantRecoveryRule.upsert({
        where: {
          merchantId_type: {
            merchantId,
            type: ruleInput.type,
          },
        },
        create: {
          merchantId,
          type: ruleInput.type,
          name: ruleInput.name,
          enabled: ruleInput.enabled,
          priority: ruleInput.priority,
          conditions: ruleInput.conditions,
          actions,
        },
        update: {
          name: ruleInput.name,
          enabled: ruleInput.enabled,
          priority: ruleInput.priority,
          conditions: ruleInput.conditions,
          actions,
        },
      });
    }

    const updated = await tx.merchantRecoveryRule.findMany({
      where: { merchantId },
    });

    return {
      beforeRules: sortRulesByPriority(existing),
      afterRules: sortRulesByPriority(updated),
    };
  });
}

/**
 * Reject requests that try to pass merchantId from the client.
 *
 * @param {unknown} body
 */
export function rejectClientMerchantId(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  if ("merchantId" in body) {
    return "merchantId must not be sent in the request body.";
  }

  if (Array.isArray(body.rules)) {
    for (const rule of body.rules) {
      if (rule && typeof rule === "object" && "merchantId" in rule) {
        return "merchantId must not be sent inside rule objects.";
      }
    }
  }

  return null;
}

/**
 * Reject disallowed rule type strings before Zod parsing.
 *
 * @param {unknown} body
 */
export function rejectDisallowedRuleTypes(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.rules)) {
    return null;
  }

  for (const rule of body.rules) {
    if (!rule || typeof rule !== "object") {
      continue;
    }

    if (
      typeof rule.type === "string" &&
      DISALLOWED_RECOVERY_RULE_TYPES.includes(rule.type)
    ) {
      return `Rule type ${rule.type} is not allowed.`;
    }
  }

  return null;
}
