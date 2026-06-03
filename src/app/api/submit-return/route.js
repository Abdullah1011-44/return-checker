import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  guessImageMimeType,
  mapRecoveryOption,
  mapReturnReason,
  normalizeEmail,
  normalizeOrderNumber,
} from "@/lib/returnApiMappers";
import {
  bestActionForReason,
  buildAiSummary,
  reasonKeyFromUiOrPrisma,
  resolveRequestEligibility,
  riskPrismaForReason,
  scoreForReason,
} from "@/lib/returnScoring";
import { serializeProofImage } from "@/lib/proofImageUrl";

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
  try {
    const body = await request.json();
    const { orderNumber, email, returnRequestItems } = body;

    if (!orderNumber || !email) {
      return NextResponse.json(
        { success: false, message: "Order number and email are required." },
        { status: 400 }
      );
    }

    if (!Array.isArray(returnRequestItems) || returnRequestItems.length === 0) {
      return NextResponse.json(
        { success: false, message: "At least one return item is required." },
        { status: 400 }
      );
    }

    const normalizedOrderNumber = normalizeOrderNumber(orderNumber);
    const normalizedEmail = normalizeEmail(email);

    const order = await prisma.customerOrder.findFirst({
      where: {
        orderNumber: normalizedOrderNumber,
        customerEmail: normalizedEmail,
      },
      include: {
        items: true,
        merchant: true,
      },
    });

    if (!order) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Order not found. Please check your order number and email address.",
        },
        { status: 404 }
      );
    }

    const returnItemsCreate = [];
    const matchedOrderItems = [];

    for (const item of returnRequestItems) {
      if (!item.returnReason || !item.selectedOption) {
        return NextResponse.json(
          {
            success: false,
            message:
              "Each return item must include a return reason and preferred resolution.",
          },
          { status: 400 }
        );
      }

      const orderItem = order.items.find(
        (oi) =>
          (item.itemId && oi.id === item.itemId) ||
          (item.sku && oi.sku === item.sku)
      );

      if (!orderItem) {
        return NextResponse.json(
          {
            success: false,
            message: `Order item not found for SKU "${item.sku ?? item.itemId ?? "unknown"}".`,
          },
          { status: 400 }
        );
      }

      matchedOrderItems.push(orderItem);
      const reasonKey = reasonKeyFromUiOrPrisma(item.returnReason);
      const bestAction = bestActionForReason(reasonKey);
      const now = new Date();

      returnItemsCreate.push({
        orderItemId: orderItem.id,
        reason: mapReturnReason(item.returnReason),
        comment: item.comment?.trim() || null,
        selectedOption: mapRecoveryOption(item.selectedOption),
        imageUrl: serializeProofImage(item.proofImageName, item.proofImage),
        imageMimeType: guessImageMimeType(item.proofImage),
        recoveryScore: scoreForReason(reasonKey),
        riskLevel: riskPrismaForReason(reasonKey),
        bestAction,
        aiSummary: buildAiSummary({
          reasonKey,
          selectedOptionLabel: item.selectedOption,
          bestAction,
        }),
        aiClassifiedAt: now,
        merchantDecision: "PENDING",
      });
    }

    const eligibility = resolveRequestEligibility(matchedOrderItems);

    let windowExpiresAt = null;
    if (order.deliveredAt && order.merchant?.returnWindowDays != null) {
      windowExpiresAt = new Date(order.deliveredAt);
      windowExpiresAt.setDate(
        windowExpiresAt.getDate() + order.merchant.returnWindowDays
      );
    }

    const returnRequest = await prisma.returnRequest.create({
      data: {
        merchantId: order.merchantId,
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
        events: {
          create: {
            eventType: "RETURN_SUBMITTED",
            actorType: "customer",
            toValue: "PENDING",
            note: `Return submitted for order #${order.orderNumber}`,
            metadata: {
              itemCount: returnItemsCreate.length,
              customerEmail: order.customerEmail,
            },
          },
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

    await prisma.returnEvent.create({
      data: {
        returnRequestId: returnRequest.id,
        eventType: "AI_SCORED",
        actorType: "ai",
        note: "AI recovery scores computed for return items",
        metadata: {
          items: returnRequest.items.map((ri) => ({
            returnItemId: ri.id,
            recoveryScore: ri.recoveryScore,
            riskLevel: ri.riskLevel,
            bestAction: ri.bestAction,
          })),
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: "Return request submitted successfully.",
      returnRequest: serializeReturnRequest(returnRequest),
    });
  } catch (error) {
    console.error("[submit-return]", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
