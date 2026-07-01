import { NextResponse } from "next/server";
import { z } from "zod";

const ORDER_NUMBER_PATTERN = /^[a-zA-Z0-9#_-]+$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: Intentionally rejects ASCII control characters from user input.
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const RETURN_REASON_VALUES = [
  "wrong_size",
  "wrong_color",
  "damaged_item",
  "wrong_item",
  "changed_mind",
  "quality_issue",
  "late_delivery",
  "other",
  "WRONG_SIZE",
  "WRONG_COLOR",
  "DAMAGED_ITEM",
  "WRONG_ITEM",
  "CHANGED_MIND",
  "QUALITY_ISSUE",
  "LATE_DELIVERY",
  "OTHER",
];

const SELECTED_OPTION_VALUES = [
  "EXCHANGE",
  "STORE_CREDIT",
  "PARTIAL_REFUND",
  "DISCOUNT_TO_KEEP",
  "FULL_REFUND",
  "MANUAL_REVIEW",
  "Exchange Product",
  "Store Credit",
  "Partial Refund",
  "Discount to Keep",
  "Full Refund",
  "Manual Review",
];

/** Trimmed string with max length; rejects newlines. */
export function safeString(maxLength) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .refine((value) => !/[\r\n]/.test(value), {
      message: "Value must not contain newline characters.",
    });
}

/** Normalized customer email (trim + lowercase). */
export function safeEmail() {
  return z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .email({ message: "Invalid email address." });
}

export const emailSchema = safeEmail();

export const orderNumberSchema = z
  .string()
  .trim()
  .min(1, { message: "Order number is required." })
  .max(50, { message: "Order number is too long." })
  .refine((value) => !/[\r\n]/.test(value), {
    message: "Order number must not contain newline characters.",
  })
  .refine((value) => ORDER_NUMBER_PATTERN.test(value), {
    message:
      "Order number may only contain letters, numbers, #, dash, and underscore.",
  });

export const merchantActionSchema = z.enum(
  ["APPROVE", "REJECT", "NEEDS_MORE_INFO", "RESOLVE"],
  { message: "Invalid merchant action." },
);

export const merchantNoteSchema = z
  .string()
  .trim()
  .max(1000, { message: "Merchant note is too long." })
  .refine((value) => !/[\r\n]/.test(value), {
    message: "Merchant note must not contain newline characters.",
  })
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
    message: "Merchant note contains invalid control characters.",
  })
  .optional();

export const returnReasonSchema = z.union([
  z.enum(RETURN_REASON_VALUES, { message: "Invalid return reason." }),
  safeString(200),
]);

export const selectedOptionSchema = z.union([
  z.enum(SELECTED_OPTION_VALUES, { message: "Invalid recovery option." }),
  safeString(100),
]);

const returnRequestItemSchema = z
  .object({
    itemId: safeString(100).optional(),
    sku: safeString(200).optional(),
    title: safeString(500).optional(),
    quantity: z.number().int().min(1).max(999).optional(),
    price: z.number().min(0).max(1_000_000).optional(),
    returnReason: returnReasonSchema,
    selectedOption: selectedOptionSchema,
    comment: safeString(1000).optional(),
    proofImageName: safeString(255).optional(),
    proofImage: z.string().max(2_000_000).optional(),
    imageUrl: safeString(2000).optional(),
  })
  .strict()
  .refine((item) => item.itemId || item.sku, {
    message: "Each return item must include itemId or sku.",
    path: ["itemId"],
  });

export const checkReturnSchema = z.object({
  orderNumber: orderNumberSchema,
  email: emailSchema,
});

export const submitReturnSchema = z
  .object({
    orderNumber: orderNumberSchema,
    email: emailSchema,
    returnRequestItems: z
      .array(returnRequestItemSchema)
      .min(1, { message: "At least one return item is required." })
      .max(50, { message: "Too many return items." }),
  })
  .strict();

export const returnRequestIdSchema = z
  .string()
  .trim()
  .min(1, { message: "Return request ID is required." })
  .max(100, { message: "Return request ID is too long." })
  .refine((value) => !/[\r\n]/.test(value), {
    message: "Return request ID must not contain newline characters.",
  })
  .refine((value) => !CONTROL_CHAR_PATTERN.test(value), {
    message: "Return request ID contains invalid control characters.",
  });

export const merchantActionBodySchema = z
  .object({
    action: merchantActionSchema,
    merchantNote: merchantNoteSchema,
  })
  .strict();

function formatZodDetails(error) {
  if (!error?.issues || !Array.isArray(error.issues)) {
    return [{ path: "body", message: "Invalid request." }];
  }

  const details = error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message,
  }));

  const limit = process.env.NODE_ENV === "production" ? 10 : 20;
  return details.slice(0, limit);
}

/** Build a safe 400 response for validation failures. */
export function validationErrorResponse(error, detailsOverride) {
  const details =
    detailsOverride ??
    formatZodDetails(error instanceof z.ZodError ? error : null);

  return NextResponse.json(
    {
      success: false,
      error: "Invalid request",
      details,
    },
    { status: 400 },
  );
}

/**
 * Safely parse JSON request body.
 * Returns { ok: true, data } or { ok: false, response }.
 */
export async function parseJsonBody(request) {
  try {
    const body = await request.json();

    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return {
        ok: false,
        response: validationErrorResponse(null, [
          { path: "body", message: "Request body must be a JSON object." },
        ]),
      };
    }

    return { ok: true, data: body };
  } catch {
    return {
      ok: false,
      response: validationErrorResponse(null, [
        { path: "body", message: "Invalid JSON body." },
      ]),
    };
  }
}

/**
 * Validate parsed body against a Zod schema.
 * Returns { ok: true, data } or { ok: false, response }.
 */
export function validateBody(schema, body) {
  const result = schema.safeParse(body);

  if (!result.success) {
    return {
      ok: false,
      response: validationErrorResponse(result.error),
    };
  }

  return { ok: true, data: result.data };
}
