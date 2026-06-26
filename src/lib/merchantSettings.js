import { z } from "zod";
import { safeEmail } from "@/lib/validation";

export const STORE_TYPES = [
  "GENERAL",
  "FASHION",
  "ELECTRONICS",
  "BEAUTY",
  "HOME",
  "FOOD",
  "OTHER",
];

export const MERCHANT_SETTINGS_UPDATED_ACTION = "MERCHANT_SETTINGS_UPDATED";

const nullableEmailSchema = z.union([safeEmail(), z.null()]);

export const merchantSettingsUpdateSchema = z
  .object({
    notifyEmail: nullableEmailSchema,
    returnWindow: z
      .number({ error: "returnWindow must be a number." })
      .int({ message: "returnWindow must be an integer." })
      .positive({ message: "returnWindow must be greater than 0." }),
    autoRejectDays: z.union([
      z
        .number({ error: "autoRejectDays must be a number." })
        .int({ message: "autoRejectDays must be an integer." })
        .positive({ message: "autoRejectDays must be greater than 0." }),
      z.null(),
    ]),
    aiConfidence: z
      .number({ error: "aiConfidence must be a number." })
      .min(0, { message: "aiConfidence must be between 0 and 1." })
      .max(1, { message: "aiConfidence must be between 0 and 1." }),
    storeType: z.enum(STORE_TYPES, {
      message: "storeType must be a supported store type.",
    }),
    allowExchange: z.boolean({ message: "allowExchange must be a boolean." }),
    allowKeepItem: z.boolean({ message: "allowKeepItem must be a boolean." }),
    allowPartialRefund: z.boolean({
      message: "allowPartialRefund must be a boolean.",
    }),
    allowStoreCredit: z.boolean({
      message: "allowStoreCredit must be a boolean.",
    }),
    freeExchangeShipping: z.boolean({
      message: "freeExchangeShipping must be a boolean.",
    }),
  })
  .strict();

const SETTINGS_FIELD_KEYS = [
  "notifyEmail",
  "returnWindow",
  "autoRejectDays",
  "aiConfidence",
  "storeType",
  "allowExchange",
  "allowKeepItem",
  "allowPartialRefund",
  "allowStoreCredit",
  "freeExchangeShipping",
];

/**
 * @param {import("@prisma/client").Merchant | { id: string; email?: string; returnWindowDays?: number; allowExchange?: boolean; allowKeepItem?: boolean; allowPartialRefund?: boolean; allowStoreCredit?: boolean; freeExchangeShipping?: boolean }} merchant
 */
export function buildDefaultMerchantSettingsCreate(merchant) {
  return {
    merchantId: merchant.id,
    notifyEmail: merchant.email ?? null,
    returnWindow: merchant.returnWindowDays ?? 30,
    autoRejectDays: null,
    aiConfidence: 0.7,
    storeType: "GENERAL",
    allowExchange: merchant.allowExchange ?? true,
    allowKeepItem: merchant.allowKeepItem ?? false,
    allowPartialRefund: merchant.allowPartialRefund ?? true,
    allowStoreCredit: merchant.allowStoreCredit ?? true,
    freeExchangeShipping: merchant.freeExchangeShipping ?? false,
  };
}

/**
 * Safe API payload — never includes Shopify tokens or unrelated merchant secrets.
 *
 * @param {import("@prisma/client").MerchantSettings} settings
 */
export function serializeMerchantSettings(settings) {
  return {
    notifyEmail: settings.notifyEmail ?? null,
    returnWindow: settings.returnWindow,
    autoRejectDays: settings.autoRejectDays ?? null,
    aiConfidence: settings.aiConfidence,
    storeType: settings.storeType,
    allowExchange: settings.allowExchange,
    allowKeepItem: settings.allowKeepItem,
    allowPartialRefund: settings.allowPartialRefund,
    allowStoreCredit: settings.allowStoreCredit,
    freeExchangeShipping: settings.freeExchangeShipping,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function snapshotSettingsValues(settings) {
  return serializeMerchantSettings(settings);
}

function valuesEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (left == null || right == null) {
    return left === right;
  }

  if (typeof left === "number" && typeof right === "number") {
    return Object.is(left, right);
  }

  return left === right;
}

/**
 * @param {import("@prisma/client").MerchantSettings} before
 * @param {import("@prisma/client").MerchantSettings} after
 */
export function buildMerchantSettingsAuditMetadata(before, after) {
  const beforeValues = snapshotSettingsValues(before);
  const afterValues = snapshotSettingsValues(after);
  const changedFields = SETTINGS_FIELD_KEYS.filter(
    (field) => !valuesEqual(beforeValues[field], afterValues[field]),
  );

  const safeBefore = {};
  const safeAfter = {};

  for (const field of changedFields) {
    safeBefore[field] = beforeValues[field];
    safeAfter[field] = afterValues[field];
  }

  return {
    merchantId: after.merchantId,
    action: MERCHANT_SETTINGS_UPDATED_ACTION,
    changedFields,
    before: safeBefore,
    after: safeAfter,
    updatedAt: after.updatedAt.toISOString(),
  };
}
