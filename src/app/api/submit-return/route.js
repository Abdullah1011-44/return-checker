import { NextResponse } from "next/server";
import { AUDIT_ACTORS, AUDIT_EVENTS, safeCreateAuditEvent } from "@/lib/audit";
import {
  DuplicateReturnRequestError,
  findDuplicateReturnItems,
  formatDuplicateItemsForResponse,
  hasDuplicateOrderItemIds,
} from "@/lib/duplicateReturnPrevention";
import { createApiErrorResponse, handleApiError } from "@/lib/errors";
import {
  buildExcludedItemAiSummary,
  buildItemExclusionMerchantNote,
  buildSingleItemTopLevelFields,
  evaluateSubmitReturnItemDecisions,
  itemDecisionToBestActionLabel,
} from "@/lib/itemRecoveryDecisions";
import {
  findCustomerOrderForReturn,
  resolveMerchantForCustomerFlow,
} from "@/lib/orderLookup";
import { prisma } from "@/lib/prisma";
import { serializeProofImage } from "@/lib/proofImageUrl";
import { checkRateLimit, rateLimitResponse } from "@/lib/rateLimit";
import {
  guessImageMimeType,
  mapRecoveryOption,
  mapReturnReason,
} from "@/lib/returnApiMappers";
import { buildPolicySummary } from "@/lib/returnPolicyIntegration";
import {
  reasonKeyFromUiOrPrisma,
  resolveRequestEligibility,
  riskPrismaForReason,
  scoreForReason,
} from "@/lib/returnScoring";
import { captureException } from "@/lib/sentry";
import { recordSubmitReturnOfferAcceptancesSafely } from "@/lib/submitReturnOfferAcceptance";
import {
  parseJsonBody,
  submitReturnSchema,
  validationErrorResponse,
} from "@/lib/validation";

function serializeReturnRequest(request) {
  return {
    ...request,
    items: request.items.map((item) => ({
      ...item,
      orderItem: item.orderItem
        ? {
            ...item.orderItem,
            price: item.orderItem.price.toString(),
          }
        : null,
    })),
  };
}

export async function POST(request) {
  let merchant = null;
  let merchantId = null;

  try {
    const rateLimitResult = checkRateLimit(request, {
      routeName: "submit-return",
      limit: 10,
      windowMs: 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return rateLimitResponse(rateLimitResult);
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }

    const validated = submitReturnSchema.safeParse(parsed.data);
    if (!validated.success) {
      return validationErrorResponse(validated.error);
    }

    const { orderNumber, email, returnRequestItems } = validated.data;

    const sessionMerchant = await resolveMerchantForCustomerFlow();

    const order = await findCustomerOrderForReturn({
      orderNumber,
      email,
      merchant: sessionMerchant,
    });

    if (!order) {
      return createApiErrorResponse(
        "Order not found or not eligible for return",
        404,
        "ORDER_NOT_ELIGIBLE",
      );
    }

    merchantId = sessionMerchant?.id ?? order.merchantId;
    merchant = sessionMerchant;

    if (sessionMerchant && order.merchantId !== sessionMerchant.id) {
      return NextResponse.json(
        {
          success: false,
          message: "Order does not belong to the current merchant.",
        },
        { status: 403 },
      );
    }

    const returnItemsCreate = [];
    const matchedOrderItems = [];
    const resolvedOrderItemIds = [];

    for (const item of returnRequestItems) {
      const orderItem = order.items.find(
        (oi) =>
          (item.itemId && oi.id === item.itemId) ||
          (item.sku && oi.sku === item.sku),
      );

      if (!orderItem) {
        return NextResponse.json(
          {
            success: false,
            message: `Order item not found for SKU "${item.sku ?? item.itemId ?? "unknown"}".`,
          },
          { status: 400 },
        );
      }

      resolvedOrderItemIds.push(orderItem.id);
      matchedOrderItems.push(orderItem);
    }

    if (hasDuplicateOrderItemIds(resolvedOrderItemIds)) {
      return NextResponse.json(
        {
          success: false,
          error: "DUPLICATE_ITEM_IDS_IN_REQUEST",
          message:
            "The same item cannot be submitted more than once in a single request.",
        },
        { status: 400 },
      );
    }

    const eligibility = resolveRequestEligibility(matchedOrderItems);

    let windowExpiresAt = null;
    if (order.deliveredAt && order.merchant?.returnWindowDays != null) {
      windowExpiresAt = new Date(order.deliveredAt);
      windowExpiresAt.setDate(
        windowExpiresAt.getDate() + order.merchant.returnWindowDays,
      );
    }

    // Per-item product exclusion (pre-flight) + independent decisions per return item.
    // Recovery rules load inside evaluateSubmitReturnItemDecisions when not on order.
    const { itemDecisions, hasExcludedItems, serializePolicyResult } =
      await evaluateSubmitReturnItemDecisions({
        merchantId,
        merchant: order.merchant,
        settings: order.merchantSettings,
        recoveryRules: order.recoveryRules,
        order,
        matchedOrderItems,

        returnRequestItems,
        windowExpiresAt,
      });

    const apiPolicyResult = serializePolicyResult();
    const now = new Date();

    for (let index = 0; index < returnRequestItems.length; index += 1) {
      const item = returnRequestItems[index];
      const orderItem = matchedOrderItems[index];
      const itemDecision = itemDecisions[index];
      const reasonKey = reasonKeyFromUiOrPrisma(item.returnReason);
      const exclusionMerchantNote =
        buildItemExclusionMerchantNote(itemDecision);

      returnItemsCreate.push({
        orderItemId: orderItem.id,
        reason: mapReturnReason(item.returnReason),
        comment: item.comment?.trim() || null,
        selectedOption: mapRecoveryOption(item.selectedOption),
        imageUrl: serializeProofImage(
          item.proofImageName,
          item.proofImage ?? item.imageUrl,
        ),
        imageMimeType: guessImageMimeType(item.proofImage ?? item.imageUrl),
        recoveryScore: scoreForReason(reasonKey),
        riskLevel: riskPrismaForReason(reasonKey),
        bestAction: itemDecisionToBestActionLabel(itemDecision),
        aiSummary: itemDecision.productExcluded
          ? buildExcludedItemAiSummary(itemDecision, {
              reasonKey,
              selectedOptionLabel: item.selectedOption,
            })
          : buildPolicySummary({
              decision: itemDecision.policyDecision?.decision,
              customerMessage: apiPolicyResult.customerMessage,
              reasonKey,
              selectedOptionLabel: item.selectedOption,
            }),
        merchantNote: exclusionMerchantNote,
        aiClassifiedAt: now,
        merchantDecision: "PENDING",
      });
    }

    const returnRequest = await prisma.$transaction(async (tx) => {
      const duplicateItems = await findDuplicateReturnItems({
        prisma: tx,
        merchantId,
        orderItemIds: resolvedOrderItemIds,
      });

      if (duplicateItems.length > 0) {
        throw new DuplicateReturnRequestError(
          formatDuplicateItemsForResponse(duplicateItems),
        );
      }

      return tx.returnRequest.create({
        data: {
          merchantId,
          orderId: order.id,
          customerEmail: order.customerEmail,
          customerName: order.customerName,
          eligibilityStatus: eligibility.status,
          eligibilityReason: eligibility.reason,
          windowExpiresAt,
          status: "PENDING",
          items: {
            create: returnItemsCreate,
          },
        },
        include: {
          order: true,
          items: {
            include: {
              orderItem: true,
            },
          },
          events: true,
        },
      });
    });

    await recordSubmitReturnOfferAcceptancesSafely({
      merchantId,
      returnRequest,
      returnRequestItems,
      matchedOrderItems,
      itemDecisions,
      recoveryRules: order.recoveryRules,
      order,
    }).catch((error) => {
      console.warn("[OfferAcceptance] submit-return tracking batch failed", {
        returnRequestId: returnRequest.id,
        errorName: error?.name ?? "Error",
        message: error?.message ?? "unknown_error",
      });
    });

    await safeCreateAuditEvent({
      returnRequestId: returnRequest.id,
      eventType: AUDIT_EVENTS.RETURN_SUBMITTED,
      actorType: AUDIT_ACTORS.CUSTOMER,
      toValue: returnRequest.status,
      note: "Customer submitted return request",
      metadata: {
        orderNumber: order.orderNumber,
        itemCount: returnRequestItems.length,
        selectedOptions: returnRequestItems.map((item) => item.selectedOption),
        reasons: returnRequestItems.map((item) => item.returnReason),
        hasImages: returnRequestItems.some(
          (item) =>
            Boolean(item.proofImage) ||
            Boolean(item.imageUrl) ||
            Boolean(item.proofImageName),
        ),
      },
    });

    await prisma.returnEvent.create({
      data: {
        returnRequestId: returnRequest.id,
        eventType: "AI_SCORED",
        actorType: "ai",
        note: "AI recovery scores computed for return items",
        metadata: {
          items: returnRequest.items.map((ri, index) => ({
            returnItemId: ri.id,
            recoveryScore: ri.recoveryScore,
            riskLevel: ri.riskLevel,
            bestAction: ri.bestAction,
            ...(itemDecisions[index]
              ? {
                  productExcluded: itemDecisions[index].productExcluded,
                  recommendedAction: itemDecisions[index].recommendedAction,
                  aiOfferSuppressed: itemDecisions[index].aiOfferSuppressed,
                  exclusionReason: itemDecisions[index].exclusionReason ?? null,
                  exclusionRuleId: itemDecisions[index].exclusionRuleId ?? null,
                  matchedField: itemDecisions[index].matchedField ?? null,
                  matchedValue: itemDecisions[index].matchedValue ?? null,
                }
              : {}),
          })),
          policyDecision: apiPolicyResult.decision,
          policyConfidence: apiPolicyResult.confidence,
          policyCustomerMessage: apiPolicyResult.customerMessage,
          hasExcludedItems,
        },
      },
    });

    const responseBody = {
      success: true,
      message: "Return request submitted successfully.",
      customerMessage: apiPolicyResult.customerMessage,
      returnRequest: serializeReturnRequest(returnRequest),
      hasExcludedItems,
      itemDecisions,
      // TODO: Persist policyResult after schema support is added.
      policyResult: apiPolicyResult,
    };

    if (itemDecisions.length === 1) {
      Object.assign(
        responseBody,
        buildSingleItemTopLevelFields(itemDecisions[0]),
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    if (error instanceof DuplicateReturnRequestError) {
      return NextResponse.json(
        {
          error: "DUPLICATE_RETURN_REQUEST",
          message: error.message,
          duplicateItems: error.duplicateItems,
        },
        { status: 409 },
      );
    }

    captureException(error, {
      route: request?.url,
      method: request?.method,
      merchantId: merchant?.id || merchantId || null,
      shopDomain: merchant?.shopDomain || null,
      action: "submit_return",
    });

    return handleApiError(error, {
      context: "submit-return",
      fallbackMessage: "Unable to submit return request. Please try again.",
      fallbackCode: "SUBMIT_RETURN_ERROR",
    });
  }
}
